import { verifyAdminToken, getServiceClient } from './_utils.js';

const VALID_PLANS = ['trial', 'basic', 'pro'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!verifyAdminToken(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const supabase = getServiceClient();
  if (!supabase) {
    res.status(500).json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY configuration.' });
    return;
  }

  const { email, days, plan, amount, note } = req.body || {};
  const extraDays = Number(days);
  if (!email || !Number.isFinite(extraDays) || extraDays <= 0) {
    res.status(400).json({ error: 'Provide a valid email and a positive number of days.' });
    return;
  }
  if (plan && !VALID_PLANS.includes(plan)) {
    res.status(400).json({ error: 'Invalid plan.' });
    return;
  }

  let cashAmountPaise = null;
  if (amount !== undefined && amount !== null && amount !== '') {
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees < 0) {
      res.status(400).json({ error: 'Enter a valid amount received (or leave it blank).' });
      return;
    }
    cashAmountPaise = Math.round(rupees * 100);
  }

  const { data, error } = await supabase.rpc('admin_grant_access', {
    target_email: email,
    extra_days: extraDays,
    new_plan: plan || null,
    cash_amount_paise: cashAmountPaise,
    note: note || null,
  });

  if (error) {
    const message = error.message.includes('user_not_found') ? 'No account found with that email.' : error.message;
    res.status(400).json({ error: message });
    return;
  }

  res.status(200).json({ entitlement: data });
}
