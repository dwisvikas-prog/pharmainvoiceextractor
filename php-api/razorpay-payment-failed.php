<?php
// Called from the frontend when a Razorpay checkout fails or is cancelled
// (payment.failed event, or the modal was dismissed) - marks the pending
// row from razorpay-create-order.php as failed, so it shows up correctly
// in the admin payments dashboard instead of staying stuck as "pending".

require_once __DIR__ . '/_utils.php';

if (apply_cors()) exit;
require_post();

if (!supabase_configured()) {
    send_json(500, ['error' => 'Server is missing SUPABASE_SERVICE_ROLE_KEY configuration.']);
}

$user = get_calling_user();
if (!$user) {
    send_json(401, ['error' => 'Please log in again.']);
}

$body = json_body();
$orderId = $body['razorpay_order_id'] ?? null;
$reason = $body['reason'] ?? 'Payment failed or cancelled';
if (!$orderId) {
    send_json(400, ['error' => 'Missing order id.']);
}

supabase_update('payments', [
    'razorpay_order_id' => 'eq.' . $orderId,
    'user_id' => 'eq.' . $user['id'],
], [
    'status' => 'failed',
    'failure_reason' => mb_substr((string) $reason, 0, 500),
]);

send_json(200, ['ok' => true]);
