<?php
// PHP rewrite of api/admin-grant.js

require_once __DIR__ . '/_utils.php';

if (apply_cors()) exit;
require_post();

if (!verify_admin_token()) {
    send_json(401, ['error' => 'Unauthorized']);
}

if (!supabase_configured()) {
    send_json(500, ['error' => 'Server is missing SUPABASE_SERVICE_ROLE_KEY configuration.']);
}

$VALID_PLANS = ['trial', 'basic', 'pro'];

$body = json_body();
$email = $body['email'] ?? null;
$days = $body['days'] ?? null;
$plan = $body['plan'] ?? null;
$amount = $body['amount'] ?? null;
$note = $body['note'] ?? null;

$extraDays = is_numeric($days) ? (float) $days : null;
if (!$email || $extraDays === null || $extraDays <= 0) {
    send_json(400, ['error' => 'Provide a valid email and a positive number of days.']);
}
if ($plan && !in_array($plan, $VALID_PLANS, true)) {
    send_json(400, ['error' => 'Invalid plan.']);
}

$cashAmountPaise = null;
if ($amount !== null && $amount !== '') {
    $rupees = is_numeric($amount) ? (float) $amount : null;
    if ($rupees === null || $rupees < 0) {
        send_json(400, ['error' => 'Enter a valid amount received (or leave it blank).']);
    }
    $cashAmountPaise = (int) round($rupees * 100);
}

[$data, $error] = supabase_rpc('admin_grant_access', [
    'target_email' => $email,
    'extra_days' => $extraDays,
    'new_plan' => $plan ?: null,
    'cash_amount_paise' => $cashAmountPaise,
    'note' => $note ?: null,
]);

if ($error) {
    $message = strpos($error, 'user_not_found') !== false ? 'No account found with that email.' : $error;
    send_json(400, ['error' => $message]);
}

send_json(200, ['entitlement' => $data]);
