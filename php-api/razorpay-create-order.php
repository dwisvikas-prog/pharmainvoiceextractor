<?php
// PHP rewrite of api/razorpay-create-order.js - creates a Razorpay order for
// a plan purchase. Amount is looked up server-side - never trust a
// client-sent amount.
//
// Configure in php-api/.env:
//   RAZORPAY_KEY_ID       (required)
//   RAZORPAY_KEY_SECRET   (required)

require_once __DIR__ . '/_utils.php';

if (apply_cors()) exit;
require_post();

$keyId = env('RAZORPAY_KEY_ID');
$keySecret = env('RAZORPAY_KEY_SECRET');
if (!$keyId || !$keySecret) {
    send_json(500, ['error' => 'Payments are not configured yet. Add RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in php-api/.env, then try again.']);
}

if (!supabase_configured()) {
    send_json(500, ['error' => 'Server is missing SUPABASE_SERVICE_ROLE_KEY configuration.']);
}

$user = get_calling_user();
if (!$user) {
    send_json(401, ['error' => 'Please log in again before paying.']);
}

$body = json_body();
$planId = $body['planId'] ?? null;
$billingCycle = $body['billingCycle'] ?? null;
$amount = plan_pricing_paise($planId, $billingCycle);
if (!$amount) {
    send_json(400, ['error' => 'Invalid plan selection.']);
}

// Don't let someone pay again for a plan they already have active - only
// block a same plan + same cycle repeat, and only while it still has real
// time left (a few days' grace near expiry so renewal still works).
$entitlementRows = supabase_select('entitlements', ['user_id' => 'eq.' . $user['id']], 'plan,billing_cycle,expires_at');
$entitlement = $entitlementRows && count($entitlementRows) > 0 ? $entitlementRows[0] : null;

if ($entitlement && $entitlement['plan'] === $planId && $entitlement['billing_cycle'] === $billingCycle) {
    $expiresAt = strtotime($entitlement['expires_at']) * 1000;
    $daysLeft = ($expiresAt - (microtime(true) * 1000)) / (24 * 60 * 60 * 1000);
    if ($daysLeft > 3) {
        $dateStr = date('d/m/Y', strtotime($entitlement['expires_at']));
        send_json(400, ['error' => "You already have an active $planId plan until $dateStr. No need to pay again yet."]);
    }
}

[$status, $bodyText] = http_request('POST', 'https://api.razorpay.com/v1/orders', [
    'amount' => $amount,
    'currency' => 'INR',
    'notes' => ['userId' => $user['id'], 'planId' => $planId, 'billingCycle' => $billingCycle],
], [
    'Content-Type: application/json',
    'Authorization: Basic ' . base64_encode("$keyId:$keySecret"),
]);

if ($status < 200 || $status >= 300) {
    error_log('Razorpay order creation failed: ' . $bodyText);
    send_json(502, ['error' => 'Could not start payment. Please try again shortly.']);
}

$order = json_decode($bodyText, true);
send_json(200, ['orderId' => $order['id'], 'amount' => $order['amount'], 'currency' => $order['currency'], 'keyId' => $keyId]);
