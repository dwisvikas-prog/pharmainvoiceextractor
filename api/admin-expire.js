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

  const { email, note } = req.body || {};
  if (!email) {
    res.status(400).json({ error: 'Missing email' });
    return;
  }

  const { data, error } = await supabase.rpc('admin_expire_access', {
    target_email: email,
    note: note || null,
  });

  if (error) {
    const message = error.message.includes('user_not_found') ? 'No account found with that email.' : error.message;
    res.status(400).json({ error: message });
    return;
  }

  res.status(200).json({ entitlement: data });
}
