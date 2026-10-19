<?php
// Admin-only: every payment attempt across all users (pending/success/failed),
// for the admin panel's global payments dashboard. Per-user history is still
// available via admin-lookup.php.

require_once __DIR__ . '/_utils.php';

if (apply_cors()) exit;
require_post();

if (!verify_admin_token()) {
    send_json(401, ['error' => 'Unauthorized']);
}

if (!supabase_configured()) {
    send_json(500, ['error' => 'Server is missing SUPABASE_SERVICE_ROLE_KEY configuration.']);
}

[$data, $error] = supabase_rpc('admin_list_all_payments', ['max_rows' => 500]);

if ($error) {
    send_json(500, ['error' => $error]);
}

send_json(200, ['payments' => $data ?: []]);
