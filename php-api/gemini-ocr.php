<?php
// PHP rewrite of api/gemini-ocr.js - proxies OCR requests to the Gemini API.
// The API key(s) live only in php-api/.env (never sent to the browser).
//
// Configure in php-api/.env:
//   GEMINI_API_KEY            (required)
//   GEMINI_API_KEY_2..10      (optional extra keys for rotation on 429/503)
//   GEMINI_MODEL              (optional, default gemini-3.5-flash)
//   GEMINI_MODEL_FALLBACK     (optional, default gemini-3.5-flash-lite)

require_once __DIR__ . '/_utils.php';

if (apply_cors()) exit;
require_post();

function get_api_keys() {
    $keys = [];
    if (env('GEMINI_API_KEY')) $keys[] = env('GEMINI_API_KEY');
    for ($i = 2; $i <= 10; $i++) {
        $key = env("GEMINI_API_KEY_$i");
        if ($key) $keys[] = $key;
    }
    return $keys;
}

$apiKeys = get_api_keys();
if (count($apiKeys) === 0) {
    send_json(500, ['error' => 'Server is missing GEMINI_API_KEY configuration']);
}

$body = json_body();
$payload = $body['payload'] ?? null;
if (!$payload) {
    send_json(400, ['error' => 'Missing payload']);
}

$primaryModel = env('GEMINI_MODEL') ?: 'gemini-3.5-flash';
$fallbackModel = env('GEMINI_MODEL_FALLBACK') ?: 'gemini-3.5-flash-lite';
$modelsToTry = [$primaryModel, $fallbackModel];

$lastStatus = 502;
$lastBody = 'All Gemini models/keys exhausted';

foreach ($modelsToTry as $model) {
    $apiUrlBase = "https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent";

    foreach ($apiKeys as $keyIndex => $apiKey) {
        $ch = curl_init("$apiUrlBase?key=$apiKey");
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
        curl_setopt($ch, CURLOPT_TIMEOUT, 120);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));

        $text = curl_exec($ch);
        if ($text === false) {
            $lastStatus = 502;
            $lastBody = curl_error($ch);
            curl_close($ch);
            continue;
        }
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($status < 200 || $status >= 300) {
            $lastStatus = $status;
            $lastBody = $text;
            // Rate limited/overloaded: try the next key immediately.
            if (($status === 503 || $status === 429) && $keyIndex < count($apiKeys) - 1) {
                continue;
            }
            // Model unavailable: stop rotating keys, try the fallback model.
            if ($status === 404) break;
            continue;
        }

        http_response_code(200);
        header('Content-Type: application/json');
        echo $text;
        exit;
    }
}

send_json($lastStatus >= 400 ? $lastStatus : 502, ['error' => $lastBody]);
