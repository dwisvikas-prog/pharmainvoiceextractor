-- Run this once in the Supabase SQL Editor. Adds a simple polling-based
-- support chat between a logged-in user and the admin panel.

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sender text not null check (sender in ('user', 'admin')),
  body text not null check (char_length(trim(body)) > 0 and char_length(body) <= 2000),
  created_at timestamptz not null default now(),
  read_by_admin boolean not null default false,
  read_by_user boolean not null default false
);
create index if not exists chat_messages_user_id_created_at_idx on public.chat_messages (user_id, created_at);

alter table public.chat_messages enable row level security;

-- Users can only ever see/send messages in their own conversation with admin.
create policy "users read own chat" on public.chat_messages
  for select to authenticated
  using (user_id = auth.uid());

create policy "users send own chat messages" on public.chat_messages
  for insert to authenticated
  with check (user_id = auth.uid() and sender = 'user');

-- Lets a user mark the admin's replies as read (read_by_user) - nothing else
-- about the row is allowed to change from the client.
create policy "users mark admin replies read" on public.chat_messages
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Admin: one row per user who has ever messaged, with their last message and
-- how many of their messages the admin hasn't read yet. Service-role only.
create or replace function public.admin_list_chats()
returns table (
  user_id uuid,
  email text,
  name text,
  last_message text,
  last_sender text,
  last_at timestamptz,
  unread_count bigint
)
language sql
security definer set search_path = public
as $$
  select t.user_id, t.email, t.name, t.last_message, t.last_sender, t.last_at, t.unread_count
  from (
    select distinct on (cm.user_id)
      cm.user_id,
      u.email::text as email,
      coalesce(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)) as name,
      cm.body as last_message,
      cm.sender as last_sender,
      cm.created_at as last_at,
      (select count(*) from public.chat_messages c2
         where c2.user_id = cm.user_id and c2.sender = 'user' and c2.read_by_admin = false) as unread_count
    from public.chat_messages cm
    join auth.users u on u.id = cm.user_id
    order by cm.user_id, cm.created_at desc
  ) t
  order by t.last_at desc;
$$;
