// Creates a Razorpay order for a plan purchase. Amount is looked up
// server-side from PLAN_PRICING_PAISE below - never trust a client-sent
// amount. Configure in Vercel project settings (Production + Preview +
// Development):
//   RAZORPAY_KEY_ID       (required)
//   RAZORPAY_KEY_SECRET   (required, server-side only)
import { getServiceClient, getCallingUser, PLAN_PRICING_PAISE, applyCors } from './_utils.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    res.status(500).json({ error: 'Payments are not configured yet. Add RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in Vercel, then try again.' });
    return;
  }

  const supabase = getServiceClient();
  if (!supabase) {
    res.status(500).json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY configuration.' });
    return;
  }

  const user = await getCallingUser(req, supabase);
  if (!user) {
    res.status(401).json({ error: 'Please log in again before paying.' });
    return;
  }

  const { planId, billingCycle } = req.body || {};
  const amount = PLAN_PRICING_PAISE[planId]?.[billingCycle];
  if (!amount) {
    res.status(400).json({ error: 'Invalid plan selection.' });
    return;
  }

  // Don't let someone pay again for a plan they already have active - only
  // block a same plan + same cycle repeat, and only while it still has real
  // time left (a few days' grace near expiry so renewal still works).
  const { data: entitlement } = await supabase
    .from('entitlements')
    .select('plan, billing_cycle, expires_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (entitlement && entitlement.plan === planId && entitlement.billing_cycle === billingCycle) {
    const daysLeft = (new Date(entitlement.expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    if (daysLeft > 3) {
      res.status(400).json({
        error: `You already have an active ${planId} plan until ${new Date(entitlement.expires_at).toLocaleDateString('en-IN')}. No need to pay again yet.`,
      });
      return;
    }
  }

  try {
    const orderResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
      },
      body: JSON.stringify({
        amount,
        currency: 'INR',
        notes: { userId: user.id, planId, billingCycle },
      }),
    });

    if (!orderResponse.ok) {
      const errText = await orderResponse.text();
      console.error('Razorpay order creation failed:', errText);
      res.status(502).json({ error: 'Could not start payment. Please try again shortly.' });
      return;
    }

    const order = await orderResponse.json();
    res.status(200).json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId });
  } catch (err) {
    console.error('Razorpay order creation error:', err);
    res.status(502).json({ error: 'Could not reach the payment gateway. Please try again shortly.' });
  }
}
