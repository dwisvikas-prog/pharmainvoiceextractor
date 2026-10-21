// Admin-only: create/list/enable/disable discount coupons (see supabase/coupons.sql).
// Separate from admin-grant.js (trial/plan days) and the hardcoded
// DWIS15/DWISFREE/TRIAL15 trial-extend passcodes.
import { verifyAdminToken, getServiceClient, applyCors } from './_utils.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
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

  const { action, code, discountPercent, expiresAt, active } = req.body || {};

  if (action === 'list') {
    const { data, error } = await supabase.rpc('admin_list_coupons');
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ coupons: data || [] });
    return;
  }

  if (action === 'create') {
    const trimmedCode = (code || '').trim();
    const percent = Number(discountPercent);
    if (!trimmedCode || !Number.isFinite(percent) || percent < 1 || percent > 100) {
      res.status(400).json({ error: 'Enter a code and a discount percent between 1 and 100.' });
      return;
    }
    const { data, error } = await supabase.rpc('admin_create_coupon', {
      p_code: trimmedCode,
      p_discount_percent: percent,
      p_expires_at: expiresAt || null,
    });
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ coupon: data });
    return;
  }

  if (action === 'toggle') {
    const trimmedCode = (code || '').trim();
    if (!trimmedCode) {
      res.status(400).json({ error: 'Missing coupon code.' });
      return;
    }
    const { data, error } = await supabase.rpc('admin_set_coupon_active', {
      p_code: trimmedCode,
      p_active: Boolean(active),
    });
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ coupon: data });
    return;
  }

  res.status(400).json({ error: 'Unknown action.' });
}
