<?php
// Public endpoint used only by the "forgot password" flow to tell the user
// up front whether an account exists for the email they typed, instead of
// Supabase's own resetPasswordForEmail() which always reports success (by
// design, to avoid account enumeration via the reset form). Deliberately
// returns only a boolean - no account details.

require_once __DIR__ . '/_utils.php';

if (apply_cors()) exit;
require_post();

if (!supabase_configured()) {
    send_json(500, ['error' => 'Server is missing SUPABASE_SERVICE_ROLE_KEY configuration.']);
}

$body = json_body();
$email = trim($body['email'] ?? '');
if (!$email) {
    send_json(400, ['error' => 'Missing email']);
}

[$data, $error] = supabase_rpc('admin_lookup_user', ['target_email' => $email]);
if ($error) {
    send_json(500, ['error' => $error]);
}

send_json(200, ['registered' => is_array($data) && count($data) > 0]);
