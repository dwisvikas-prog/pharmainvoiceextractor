// Admin login for the /#admin panel. Totally separate from Supabase user
// auth - just checks a shared secret (ADMIN_PASSCODE, server-side env var)
// and hands back a signed, stateless token the client stores locally.
import { signAdminToken, getServiceClient, getRequestIp, logAdminLoginAttempt, isAdminLoginRateLimited, applyCors } from './_utils.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const adminPasscode = process.env.ADMIN_PASSCODE;
  const supabase = getServiceClient();
  const ip = getRequestIp(req);

  if (!adminPasscode || !process.env.ADMIN_TOKEN_SECRET) {
    res.status(500).json({ error: 'Admin panel is not configured (ADMIN_PASSCODE / ADMIN_TOKEN_SECRET missing).' });
    return;
  }

  if (await isAdminLoginRateLimited(supabase, ip)) {
    res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
    return;
  }

  const { passcode } = req.body || {};
  const isCorrect = Boolean(passcode) && passcode === adminPasscode;

  await logAdminLoginAttempt(supabase, isCorrect, ip);

  if (!isCorrect) {
    res.status(401).json({ error: 'Invalid passcode' });
    return;
  }

  res.status(200).json({ token: signAdminToken() });
}
