// Admin-only: support chat with users (see supabase/chat.sql). Users send
// messages directly to Supabase (RLS-scoped to their own row); the admin
// panel goes through here with the service role so it can see every
// conversation and reply as 'admin'.
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

  const { action, userId, body } = req.body || {};

  if (action === 'conversations') {
    const { data, error } = await supabase.rpc('admin_list_chats');
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ conversations: data || [] });
    return;
  }

  if (action === 'messages') {
    if (!userId) { res.status(400).json({ error: 'Missing userId.' }); return; }
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) { res.status(500).json({ error: error.message }); return; }
    await supabase.from('chat_messages').update({ read_by_admin: true }).eq('user_id', userId).eq('sender', 'user').eq('read_by_admin', false);
    res.status(200).json({ messages: data || [] });
    return;
  }

  if (action === 'send') {
    const trimmed = (body || '').trim();
    if (!userId || !trimmed) { res.status(400).json({ error: 'Missing userId or message body.' }); return; }
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({ user_id: userId, sender: 'admin', body: trimmed, read_by_admin: true, read_by_user: false })
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ message: data });
    return;
  }

  res.status(400).json({ error: 'Unknown action.' });
}
