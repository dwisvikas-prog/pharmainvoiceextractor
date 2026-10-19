-- Run this once in the Supabase SQL Editor. Tracks pending/success/failed
-- for every Razorpay checkout attempt (not just successful ones), and adds
-- an admin function to list every payment across all users (not just one
-- searched user) for a "professional" payments dashboard.

alter table public.payments
  add column if not exists status text not null default 'success' check (status in ('pending', 'success', 'failed')),
  add column if not exists failure_reason text;

-- Admin: every payment across all users, most recent first, with the
-- user's email/name joined in so the admin panel doesn't need a second
-- lookup per row.
create or replace function public.admin_list_all_payments(max_rows integer default 500)
returns table (
  id bigint,
  user_id uuid,
  email text,
  name text,
  plan text,
  billing_cycle text,
  amount_paise integer,
  status text,
  failure_reason text,
  source text,
  razorpay_payment_id text,
  razorpay_order_id text,
  note text,
  created_at timestamptz
)
language sql
security definer set search_path = public
as $$
  select
    p.id,
    p.user_id,
    u.email::text,
    coalesce(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
    p.plan,
    p.billing_cycle,
    p.amount_paise,
    p.status,
    p.failure_reason,
    p.source,
    p.razorpay_payment_id,
    p.razorpay_order_id,
    p.note,
    p.created_at
  from public.payments p
  join auth.users u on u.id = p.user_id
  order by p.created_at desc
  limit max_rows;
$$;
