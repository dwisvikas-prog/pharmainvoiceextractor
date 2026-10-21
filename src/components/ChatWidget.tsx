import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';
import { supabase } from '../utils/auth';

interface ChatMessage {
  id: number;
  sender: 'user' | 'admin';
  body: string;
  created_at: string;
  read_by_user: boolean;
}

// Floating support-chat widget: talks straight to Supabase (RLS keeps a user
// scoped to their own conversation), polling for new messages since this
// project has no websocket/realtime infra set up.
export default function ChatWidget({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [unread, setUnread] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchMessages = async () => {
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (data) {
      setMessages(data as ChatMessage[]);
      if (!open) {
        setUnread(data.filter((m: ChatMessage) => m.sender === 'admin' && !m.read_by_user).length);
      }
    }
  };

  useEffect(() => {
    fetchMessages();
    const timer = setInterval(fetchMessages, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (open) {
      setUnread(0);
      supabase.from('chat_messages').update({ read_by_user: true }).eq('user_id', userId).eq('sender', 'admin').eq('read_by_user', false).then(() => {});
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [open, messages.length, userId]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setIsSending(true);
    const { error } = await supabase.from('chat_messages').insert({ user_id: userId, sender: 'user', body: text });
    if (!error) {
      setInput('');
      fetchMessages();
    }
    setIsSending(false);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6">
      {open && (
        <div className="mb-3 flex h-[28rem] w-80 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between bg-blue-600 px-4 py-3">
            <p className="text-sm font-semibold text-white">Support chat</p>
            <button type="button" onClick={() => setOpen(false)} className="text-white/80 hover:text-white" aria-label="Close chat">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
            {messages.length === 0 && (
              <p className="mt-6 text-center text-xs text-slate-400">Have a question? Send us a message and the team will reply here.</p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs ${
                  m.sender === 'user' ? 'bg-blue-600 text-white' : 'bg-white text-slate-800 shadow-sm'
                }`}>
                  <p>{m.body}</p>
                  <p className={`mt-1 text-[9px] ${m.sender === 'user' ? 'text-blue-100' : 'text-slate-400'}`}>
                    {new Date(m.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-center gap-2 border-t border-slate-200 p-2.5">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message"
              className="flex-1 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-900 outline-none focus:border-blue-500 focus:bg-white"
            />
            <button
              type="submit"
              disabled={isSending || !input.trim()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-700 disabled:opacity-50"
              aria-label="Send"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-xl shadow-blue-600/30 transition hover:bg-blue-700"
        aria-label="Toggle support chat"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
        {!open && unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    </div>
  );
}
