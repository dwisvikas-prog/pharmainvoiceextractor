<?php
// Shared helpers for the PHP rewrite of the Vercel /api/*.js functions.
// Mirrors api/_utils.js exactly so behavior stays identical.

// ---- tiny .env loader (no Composer needed) --------------------------------
function env_load() {
    static $loaded = false;
    if ($loaded) return;
    $loaded = true;
    $path = __DIR__ . '/.env';
    if (!file_exists($path)) return;
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;
        $eq = strpos($line, '=');
        if ($eq === false) continue;
        $key = trim(substr($line, 0, $eq));
        $value = trim(substr($line, $eq + 1));
        // strip optional surrounding quotes
        if (strlen($value) >= 2 && ($value[0] === '"' || $value[0] === "'") && substr($value, -1) === $value[0]) {
            $value = substr($value, 1, -1);
        }
        if (getenv($key) === false) {
            putenv("$key=$value");
            $_ENV[$key] = $value;
        }
    }
}

function env($key, $default = null) {
    env_load();
    $value = getenv($key);
    return $value === false ? $default : $value;
}

// ---- CORS -------------------------------------------------------------
// Returns true if the request was an OPTIONS preflight (already responded to
// - caller should exit immediately).
function apply_cors() {
    header('Access-Control-Allow-Origin: ' . (env('ALLOWED_ORIGIN') ?: '*'));
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        return true;
    }
    return false;
}

function json_body() {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function send_json($status, $data) {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

function require_post() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        send_json(405, ['error' => 'Method not allowed']);
    }
}

// ---- base64url helpers -------------------------------------------------
function base64url_encode($data) {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function base64url_decode($data) {
    $pad = strlen($data) % 4;
    if ($pad) $data .= str_repeat('=', 4 - $pad);
    return base64_decode(strtr($data, '-_', '+/'));
}

// ---- stateless admin session token -------------------------------------
// base64url(JSON{exp}) + "." + HMAC-SHA256 of that payload, signed with
// ADMIN_TOKEN_SECRET. Mirrors signAdminToken()/verifyAdminToken() in
// api/_utils.js exactly, so tokens are interchangeable between the two.
const ADMIN_SESSION_MS = 2 * 60 * 60 * 1000; // 2 hours

function sign_admin_token() {
    $secret = env('ADMIN_TOKEN_SECRET');
    $expMs = (int) round(microtime(true) * 1000) + ADMIN_SESSION_MS;
    $payload = base64url_encode(json_encode(['exp' => $expMs]));
    $signature = base64url_encode(hash_hmac('sha256', $payload, $secret, true));
    return "$payload.$signature";
}

function verify_admin_token() {
    $secret = env('ADMIN_TOKEN_SECRET');
    $authHeader = get_authorization_header();
    $token = (strpos($authHeader, 'Bearer ') === 0) ? substr($authHeader, 7) : '';
    if (!$token || !$secret) return false;

    $parts = explode('.', $token);
    if (count($parts) !== 2) return false;
    [$payload, $signature] = $parts;

    $expected = base64url_encode(hash_hmac('sha256', $payload, $secret, true));
    if (!hash_equals($expected, $signature)) return false;

    $decoded = json_decode(base64url_decode($payload), true);
    return isset($decoded['exp']) && is_numeric($decoded['exp']) && $decoded['exp'] > round(microtime(true) * 1000);
}

function get_authorization_header() {
    if (isset($_SERVER['HTTP_AUTHORIZATION'])) return $_SERVER['HTTP_AUTHORIZATION'];
    if (function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        foreach ($headers as $k => $v) {
            if (strtolower($k) === 'authorization') return $v;
        }
    }
    return '';
}

function get_request_ip() {
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $parts = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
        return trim($parts[0]);
    }
    return $_SERVER['REMOTE_ADDR'] ?? null;
}

// ---- plan pricing (paise) -----------------------------------------------
// Keep in sync with src/utils/auth.ts PLAN_PRICING and api/_utils.js.
function plan_pricing_paise($planId, $billingCycle) {
    $table = [
        'basic' => ['monthly' => 300 * 100, 'yearly' => 3000 * 100],
        'pro' => ['monthly' => 500 * 100, 'yearly' => 5000 * 100],
    ];
    return $table[$planId][$billingCycle] ?? null;
}

// ---- Supabase REST helpers (service_role) --------------------------------
// No official PHP SDK, so these talk to Supabase's REST (PostgREST) and Auth
// endpoints directly with cURL - same effect as the JS supabase-js client.

function supabase_configured() {
    return (bool) (env('VITE_SUPABASE_URL') ?: env('SUPABASE_URL')) && (bool) env('SUPABASE_SERVICE_ROLE_KEY');
}

function supabase_url() {
    return rtrim(env('VITE_SUPABASE_URL') ?: env('SUPABASE_URL'), '/');
}

// Calls a Postgres function exposed via PostgREST RPC, using the service_role
// key (bypasses Row Level Security - server-side only, mirrors
// getServiceClient() + supabase.rpc() in the JS version).
function supabase_rpc($fn, $params) {
    $serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
    $url = supabase_url() . '/rest/v1/rpc/' . $fn;
    [$status, $body] = http_request('POST', $url, $params, [
        'apikey: ' . $serviceKey,
        'Authorization: Bearer ' . $serviceKey,
        'Content-Type: application/json',
    ]);
    $data = json_decode($body, true);
    if ($status >= 400) {
        $message = is_array($data) && isset($data['message']) ? $data['message'] : $body;
        return [null, $message ?: "Supabase RPC $fn failed ($status)"];
    }
    return [$data, null];
}

// Inserts a row via PostgREST. Used for the best-effort admin login audit log.
function supabase_insert($table, $row) {
    $serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
    $url = supabase_url() . '/rest/v1/' . $table;
    http_request('POST', $url, $row, [
        'apikey: ' . $serviceKey,
        'Authorization: Bearer ' . $serviceKey,
        'Content-Type: application/json',
        'Prefer: return=minimal',
    ]);
}

// Updates rows via PostgREST matching simple eq() filters, e.g.
// supabase_update('payments', ['razorpay_order_id' => 'eq.' . $orderId], ['status' => 'success'])
function supabase_update($table, $filters, $patch) {
    $serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
    $query = $filters;
    $url = supabase_url() . '/rest/v1/' . $table . '?' . http_build_query($query);
    http_request('PATCH', $url, $patch, [
        'apikey: ' . $serviceKey,
        'Authorization: Bearer ' . $serviceKey,
        'Content-Type: application/json',
        'Prefer: return=minimal',
    ]);
}

// Selects rows via PostgREST with simple eq() filters, e.g.
// supabase_select('entitlements', ['user_id' => 'eq.' . $id], 'plan,billing_cycle,expires_at')
function supabase_select($table, $filters, $columns = '*') {
    $serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
    $query = ['select' => $columns];
    foreach ($filters as $k => $v) $query[$k] = $v;
    $url = supabase_url() . '/rest/v1/' . $table . '?' . http_build_query($query);
    [$status, $body] = http_request('GET', $url, null, [
        'apikey: ' . $serviceKey,
        'Authorization: Bearer ' . $serviceKey,
    ]);
    if ($status >= 400) return null;
    return json_decode($body, true);
}

// Resolves the calling app user from the Supabase access token in
// Authorization: Bearer <token>, via Supabase's Auth REST endpoint. Mirrors
// getCallingUser() in api/_utils.js.
function get_calling_user() {
    $authHeader = get_authorization_header();
    $accessToken = (strpos($authHeader, 'Bearer ') === 0) ? substr($authHeader, 7) : '';
    if (!$accessToken) return null;

    $anonKey = env('VITE_SUPABASE_ANON_KEY') ?: env('SUPABASE_SERVICE_ROLE_KEY');
    $url = supabase_url() . '/auth/v1/user';
    [$status, $body] = http_request('GET', $url, null, [
        'apikey: ' . $anonKey,
        'Authorization: Bearer ' . $accessToken,
    ]);
    if ($status >= 400) return null;
    $data = json_decode($body, true);
    return isset($data['id']) ? $data : null;
}

const ADMIN_LOGIN_WINDOW_SECONDS = 15 * 60;
const ADMIN_LOGIN_MAX_FAILURES = 5;

// Blocks further passcode attempts once an IP has racked up too many recent
// failures, so the passcode can't just be brute-forced over the network.
// Mirrors isAdminLoginRateLimited() in api/_utils.js. Fails open if Supabase
// is unreachable/not configured - availability of the login form must never
// hinge on this check.
function is_admin_login_rate_limited($ip) {
    if (!$ip || !supabase_configured()) return false;
    try {
        $since = gmdate('Y-m-d\TH:i:s\Z', time() - ADMIN_LOGIN_WINDOW_SECONDS);
        $rows = supabase_select('admin_login_attempts', [
            'ip' => 'eq.' . $ip,
            'success' => 'eq.false',
            'created_at' => 'gte.' . $since,
        ], 'id');
        if (!is_array($rows)) return false;
        return count($rows) >= ADMIN_LOGIN_MAX_FAILURES;
    } catch (Throwable $e) {
        return false;
    }
}

// Minimal cURL wrapper. Returns [httpStatus, rawBody].
function http_request($method, $url, $jsonBody, $headers) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    if ($jsonBody !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($jsonBody));
    }
    $body = curl_exec($ch);
    if ($body === false) {
        $err = curl_error($ch);
        curl_close($ch);
        return [502, json_encode(['error' => $err])];
    }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$status, $body];
}
