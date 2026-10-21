// Admin-only: read-only activity log (admin_audit_log table - see
// supabase/admin_and_payments.sql). Every grant/expire/coupon action already
// writes a row there; this just exposes it to the admin panel.
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

  const { data, error } = await supabase
    .from('admin_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json({ entries: data || [] });
}
