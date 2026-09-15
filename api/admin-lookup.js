import { verifyAdminToken, getServiceClient } from './_utils.js';

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

  const { email } = req.body || {};
  if (!email) {
    res.status(400).json({ error: 'Missing email' });
    return;
  }

  const { data, error } = await supabase.rpc('admin_lookup_user', { target_email: email });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data || data.length === 0) {
    res.status(404).json({ error: 'No account found with that email.' });
    return;
  }

  const foundUser = data[0];
  const { data: payments } = await supabase.rpc('admin_list_payments', { target_user_id: foundUser.user_id });

  res.status(200).json({ user: foundUser, payments: payments || [] });
}
