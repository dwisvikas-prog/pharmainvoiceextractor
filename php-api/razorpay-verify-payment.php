<?php
// PHP rewrite of api/razorpay-verify-payment.js - verifies a completed
// Razorpay checkout server-side (HMAC signature check - never trust the
// browser's "payment succeeded" callback alone) and only then grants the
// plan via the service-role apply_paid_plan() Postgres function.

require_once __DIR__ . '/_utils.php';

if (apply_cors()) exit;
require_post();

$keyId = env('RAZORPAY_KEY_ID');
$keySecret = env('RAZORPAY_KEY_SECRET');
if (!$keyId || !$keySecret) {
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
$couponCode = trim($body['couponCode'] ?? '');

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

// Amount actually charged - read it back from Razorpay rather than
// recomputing locally, so the logged payment always matches what the
// customer was really billed (coupon discount included).
$actualAmountPaise = plan_pricing_paise($planId, $billingCycle);
[$orderStatus, $orderBodyText] = http_request('GET', "https://api.razorpay.com/v1/orders/$orderId", null, [
    'Authorization: Basic ' . base64_encode("$keyId:$keySecret"),
]);
if ($orderStatus >= 200 && $orderStatus < 300) {
    $orderData = json_decode($orderBodyText, true);
    if (isset($orderData['amount'])) {
        $actualAmountPaise = (int) $orderData['amount'];
    }
}

// The payments row was already inserted (status='pending') when the order
// was created - update it in place rather than inserting a second row, so
// apply_paid_plan is told not to insert its own.
supabase_update('payments', ['razorpay_order_id' => 'eq.' . $orderId], [
    'status' => 'success',
    'razorpay_payment_id' => $paymentId,
    'amount_paise' => $actualAmountPaise,
]);

[$data, $error] = supabase_rpc('apply_paid_plan', [
    'target_user_id' => $user['id'],
    'new_plan' => $planId,
    'new_cycle' => $billingCycle,
    'days' => $CYCLE_DAYS[$billingCycle],
    'amount_paise' => null,
    'razorpay_payment_id' => $paymentId,
    'razorpay_order_id' => $orderId,
]);

if ($error) {
    error_log('apply_paid_plan failed: ' . $error);
    send_json(500, ['error' => 'Payment verified but access could not be granted. Contact support with your payment ID.']);
}

if ($couponCode) {
    // Best-effort - payment and plan are already granted; don't fail the
    // request just because marking the coupon used hit a race/edge case.
    supabase_rpc('redeem_discount_coupon', ['p_code' => $couponCode, 'p_user_id' => $user['id']]);
}

send_json(200, ['entitlement' => $data]);
