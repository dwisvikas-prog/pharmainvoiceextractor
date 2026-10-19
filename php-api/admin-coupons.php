<?php
// Admin-only: create/list/enable/disable discount coupons (see supabase/coupons.sql).
// Separate from admin-grant.php (trial/plan days) and the hardcoded
// DWIS15/DWISFREE/TRIAL15 trial-extend passcodes.

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
$action = $body['action'] ?? null;

if ($action === 'list') {
    [$data, $error] = supabase_rpc('admin_list_coupons', []);
    if ($error) send_json(500, ['error' => $error]);
    send_json(200, ['coupons' => $data ?: []]);
}

if ($action === 'create') {
    $code = trim($body['code'] ?? '');
    $percent = (int) ($body['discountPercent'] ?? 0);
    $expiresAt = $body['expiresAt'] ?? null; // ISO string or null

    if (!$code || $percent < 1 || $percent > 100) {
        send_json(400, ['error' => 'Enter a code and a discount percent between 1 and 100.']);
    }

    [$data, $error] = supabase_rpc('admin_create_coupon', [
        'p_code' => $code,
        'p_discount_percent' => $percent,
        'p_expires_at' => $expiresAt ?: null,
    ]);
    if ($error) send_json(500, ['error' => $error]);
    send_json(200, ['coupon' => $data]);
}

if ($action === 'toggle') {
    $code = trim($body['code'] ?? '');
    $active = (bool) ($body['active'] ?? false);
    if (!$code) send_json(400, ['error' => 'Missing coupon code.']);

    [$data, $error] = supabase_rpc('admin_set_coupon_active', [
        'p_code' => $code,
        'p_active' => $active,
    ]);
    if ($error) send_json(500, ['error' => $error]);
    send_json(200, ['coupon' => $data]);
}

send_json(400, ['error' => 'Unknown action.']);
