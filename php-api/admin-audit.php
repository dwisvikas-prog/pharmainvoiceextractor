<?php
// Admin-only: read-only activity log (admin_audit_log table - see
// supabase/admin_and_payments.sql). Every grant/expire/coupon action already
// writes a row there; this just exposes it to the admin panel.

require_once __DIR__ . '/_utils.php';

if (apply_cors()) exit;
require_post();

if (!verify_admin_token()) {
    send_json(401, ['error' => 'Unauthorized']);
}

if (!supabase_configured()) {
    send_json(500, ['error' => 'Server is missing SUPABASE_SERVICE_ROLE_KEY configuration.']);
}

$rows = supabase_select('admin_audit_log', [
    'order' => 'created_at.desc',
    'limit' => '300',
]);

send_json(200, ['entries' => $rows ?: []]);
