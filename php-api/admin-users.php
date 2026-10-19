<?php
// PHP rewrite of api/admin-users.js

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
$search = $body['search'] ?? null;

[$data, $error] = supabase_rpc('admin_list_users', [
    'search_term' => $search ?: null,
    'max_rows' => 500,
]);

if ($error) {
    send_json(500, ['error' => $error]);
}

send_json(200, ['users' => $data ?: []]);
