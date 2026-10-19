<?php
// PHP rewrite of api/razorpay-verify-payment.js - verifies a completed
// Razorpay checkout server-side (HMAC signature check - never trust the
// browser's "payment succeeded" callback alone) and only then grants the
// plan via the service-role apply_paid_plan() Postgres function.

require_once __DIR__ . '/_utils.php';

if (apply_cors()) exit;
require_post();

$keySecret = env('RAZORPAY_KEY_SECRET');
if (!$keySecret) {
    send_json(500, ['error' => 'Payments are not configured yet.']);
}

if (!supabase_configured()) {
    send_json(500, ['error' => 'Server is missing SUPABASE_SERVICE_ROLE_KEY configuration.']);
}

$user = get_calling_user();
if (!$user) {
    send_json(401, ['error' => 'Session expired. Please log in again.']);
}

$CYCLE_DAYS = ['monthly' => 30, 'yearly' => 365];
$VALID_PLANS = ['basic', 'pro'];

$body = json_body();
$orderId = $body['razorpay_order_id'] ?? null;
$paymentId = $body['razorpay_payment_id'] ?? null;
$signature = $body['razorpay_signature'] ?? null;
$planId = $body['planId'] ?? null;
$billingCycle = $body['billingCycle'] ?? null;

if (!$orderId || !$paymentId || !$signature || !$planId || !$billingCycle) {
    send_json(400, ['error' => 'Missing payment details.']);
}
if (!in_array($planId, $VALID_PLANS, true) || !isset($CYCLE_DAYS[$billingCycle])) {
    send_json(400, ['error' => 'Invalid plan selection.']);
}

$expectedSignature = hash_hmac('sha256', "$orderId|$paymentId", $keySecret);
if (!hash_equals($expectedSignature, (string) $signature)) {
    send_json(400, ['error' => 'Payment verification failed. If money was deducted, contact support with your payment ID.']);
}

[$data, $error] = supabase_rpc('apply_paid_plan', [
    'target_user_id' => $user['id'],
    'new_plan' => $planId,
    'new_cycle' => $billingCycle,
    'days' => $CYCLE_DAYS[$billingCycle],
    'amount_paise' => plan_pricing_paise($planId, $billingCycle),
    'razorpay_payment_id' => $paymentId,
    'razorpay_order_id' => $orderId,
]);

if ($error) {
    error_log('apply_paid_plan failed: ' . $error);
    send_json(500, ['error' => 'Payment verified but access could not be granted. Contact support with your payment ID.']);
}

send_json(200, ['entitlement' => $data]);
