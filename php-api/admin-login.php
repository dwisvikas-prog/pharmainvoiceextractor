<?php
// PHP rewrite of api/admin-login.js - admin login for the /#admin panel.
// Totally separate from Supabase user auth - just checks a shared secret
// (ADMIN_PASSCODE) and hands back a signed, stateless token.

require_once __DIR__ . '/_utils.php';

if (apply_cors()) exit;
require_post();

$adminPasscode = env('ADMIN_PASSCODE');
$ip = get_request_ip();

if (!$adminPasscode || !env('ADMIN_TOKEN_SECRET')) {
    send_json(500, ['error' => 'Admin panel is not configured (ADMIN_PASSCODE / ADMIN_TOKEN_SECRET missing).']);
}

if (is_admin_login_rate_limited($ip)) {
    send_json(429, ['error' => 'Too many failed attempts. Try again in 15 minutes.']);
}

$body = json_body();
$passcode = $body['passcode'] ?? null;
$isCorrect = $passcode && hash_equals($adminPasscode, (string) $passcode);

if (supabase_configured()) {
    // Best-effort audit log - never blocks/breaks login.
    try {
        supabase_insert('admin_login_attempts', ['success' => $isCorrect, 'ip' => $ip]);
    } catch (Throwable $e) {
        // swallow
    }
}

if (!$isCorrect) {
    send_json(401, ['error' => 'Invalid passcode']);
}

send_json(200, ['token' => sign_admin_token()]);
