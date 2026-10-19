<?php
// PHP rewrite of api/admin-expire.js

require_once __DIR__ . '/_utils.php';

if (apply_cors()) exit;
require_post();

if (!verify_admin_token()) {
    send_json(401, ['error' => 'Unauthorized']);
}

if (!supabase_configured()) {
    send_json(500, ['error' => 'Server is missing SUPABASE_SERVICE_ROLE_KEY configuration.']);
}

$body = json_body();
$email = $body['email'] ?? null;
$note = $body['note'] ?? null;
if (!$email) {
    send_json(400, ['error' => 'Missing email']);
}

[$data, $error] = supabase_rpc('admin_expire_access', [
    'target_email' => $email,
    'note' => $note ?: null,
]);

if ($error) {
    $message = strpos($error, 'user_not_found') !== false ? 'No account found with that email.' : $error;
    send_json(400, ['error' => $message]);
}

send_json(200, ['entitlement' => $data]);
