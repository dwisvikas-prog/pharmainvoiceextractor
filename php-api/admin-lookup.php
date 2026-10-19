<?php
// PHP rewrite of api/admin-lookup.js

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
if (!$email) {
    send_json(400, ['error' => 'Missing email']);
}

[$data, $error] = supabase_rpc('admin_lookup_user', ['target_email' => $email]);
if ($error) {
    send_json(500, ['error' => $error]);
}
if (!$data || count($data) === 0) {
    send_json(404, ['error' => 'No account found with that email.']);
}

$foundUser = $data[0];
[$payments] = supabase_rpc('admin_list_payments', ['target_user_id' => $foundUser['user_id']]);

send_json(200, ['user' => $foundUser, 'payments' => $payments ?: []]);
