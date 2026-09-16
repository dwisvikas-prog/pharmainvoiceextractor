// Verifies a completed Razorpay checkout server-side (HMAC signature check -
// never trust the browser's "payment succeeded" callback alone) and only
// then grants the plan via the service-role apply_paid_plan() function.
import crypto from 'crypto';
import { getServiceClient, getCallingUser, PLAN_PRICING_PAISE, applyCors } from './_utils.js';

const CYCLE_DAYS = { monthly: 30, yearly: 365 };
const VALID_PLANS = ['basic', 'pro'];

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    res.status(500).json({ error: 'Payments are not configured yet.' });
    return;
  }

  const supabase = getServiceClient();
  if (!supabase) {
    res.status(500).json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY configuration.' });
    return;
  }

  const user = await getCallingUser(req, supabase);
  if (!user) {
    res.status(401).json({ error: 'Session expired. Please log in again.' });
    return;
  }

  const {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
    planId,
    billingCycle,
  } = req.body || {};

  if (!orderId || !paymentId || !signature || !planId || !billingCycle) {
    res.status(400).json({ error: 'Missing payment details.' });
    return;
  }
  if (!VALID_PLANS.includes(planId) || !CYCLE_DAYS[billingCycle]) {
    res.status(400).json({ error: 'Invalid plan selection.' });
    return;
  }

  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  if (expectedSignature !== signature) {
    res.status(400).json({ error: 'Payment verification failed. If money was deducted, contact support with your payment ID.' });
    return;
  }

  const { data, error } = await supabase.rpc('apply_paid_plan', {
    target_user_id: user.id,
    new_plan: planId,
    new_cycle: billingCycle,
    days: CYCLE_DAYS[billingCycle],
    amount_paise: PLAN_PRICING_PAISE[planId]?.[billingCycle] ?? null,
    razorpay_payment_id: paymentId,
    razorpay_order_id: orderId,
  });

  if (error) {
    console.error('apply_paid_plan failed:', error);
    res.status(500).json({ error: 'Payment verified but access could not be granted. Contact support with your payment ID.' });
    return;
  }

  res.status(200).json({ entitlement: data });
}
