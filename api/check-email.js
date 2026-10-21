import { getServiceClient, applyCors } from './_utils.js';

// Public endpoint used only by the "forgot password" flow to tell the user
// up front whether an account exists for the email they typed, instead of
// Supabase's own resetPasswordForEmail() which always reports success (by
// design, to avoid account enumeration via the reset form). Deliberately
// returns only a boolean - no account details.
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
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

  const { data, error } = await supabase.rpc('admin_lookup_user', { target_email: String(email).trim() });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json({ registered: Array.isArray(data) && data.length > 0 });
}
