-- Single source of truth for the admin panel + payments database changes.
-- Safe to re-run any time (uses IF NOT EXISTS / CREATE OR REPLACE / DROP IF
-- EXISTS throughout) - whenever this file changes, just run it again in the
-- Supabase SQL Editor. No other SQL file is needed for this feature.

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  target_email text not null,
  extra_days integer not null,
  new_plan text,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
alter table public.admin_audit_log add column if not exists action text not null default 'grant';

create table if not exists public.admin_login_attempts (
  id bigint generated always as identity primary key,
  success boolean not null,
  ip text,
  created_at timestamptz not null default now()
);
alter table public.admin_login_attempts enable row level security;

create table if not exists public.payments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null,
  billing_cycle text not null,
  amount_paise integer not null,
  razorpay_payment_id text,
  razorpay_order_id text,
  created_at timestamptz not null default now()
);
alter table public.payments enable row level security;

drop policy if exists "read own payments" on public.payments;
create policy "read own payments"
  on public.payments for select
  using (auth.uid() = user_id);

alter table public.payments
  add column if not exists source text not null default 'razorpay' check (source in ('razorpay', 'cash', 'coupon')),
  add column if not exists note text;

create or replace function public.admin_lookup_user(target_email text)
returns table (
  user_id uuid,
  email text,
  name text,
  plan text,
  billing_cycle text,
  expires_at timestamptz,
  ocr_used integer,
  ocr_period_key text
)
language plpgsql
security definer set search_path = public
as $$
begin
  return query
    select
      u.id,
      u.email::text,
      coalesce(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
      e.plan,
      e.billing_cycle,
      e.expires_at,
      e.ocr_used,
      e.ocr_period_key
    from auth.users u
    join public.entitlements e on e.user_id = u.id
    where lower(u.email) = lower(trim(target_email));
end;
$$;

drop function if exists public.apply_paid_plan(uuid, text, text, integer);

create or replace function public.apply_paid_plan(
  target_user_id uuid,
  new_plan text,
  new_cycle text,
  days integer,
  amount_paise integer default null,
  razorpay_payment_id text default null,
  razorpay_order_id text default null
)
returns public.entitlements
language plpgsql
security definer set search_path = public
as $$
declare
  result public.entitlements;
begin
  -- Strict duration: a paid plan always gets exactly `days` from the moment of
  -- payment, never stacked on top of whatever was left on the old plan/trial.
  update public.entitlements
    set plan = new_plan,
        billing_cycle = new_cycle,
        expires_at = now() + make_interval(days => days)
    where user_id = target_user_id
    returning * into result;

  if result is null then
    raise exception 'user_not_found';
  end if;

  if amount_paise is not null then
    insert into public.payments (user_id, plan, billing_cycle, amount_paise, razorpay_payment_id, razorpay_order_id)
      values (target_user_id, new_plan, new_cycle, amount_paise, razorpay_payment_id, razorpay_order_id);
  end if;

  return result;
end;
$$;

create or replace function public.admin_list_payments(target_user_id uuid)
returns setof public.payments
language sql
security definer set search_path = public
as $$
  select * from public.payments where user_id = target_user_id order by created_at desc;
$$;

drop function if exists public.admin_grant_access(text, integer, text);

create or replace function public.admin_grant_access(
  target_email text,
  extra_days integer,
  new_plan text default null,
  cash_amount_paise integer default null,
  note text default null
)
returns public.entitlements
language plpgsql
security definer set search_path = public
as $$
declare
  target_user_id uuid;
  result public.entitlements;
begin
  select id into target_user_id from auth.users where lower(email) = lower(trim(target_email));
  if target_user_id is null then
    raise exception 'user_not_found';
  end if;

  update public.entitlements
    set expires_at = greatest(expires_at, now()) + make_interval(days => extra_days),
        plan = coalesce(new_plan, plan)
    where user_id = target_user_id
    returning * into result;

  insert into public.admin_audit_log (target_email, extra_days, new_plan)
    values (lower(trim(target_email)), extra_days, new_plan);

  if cash_amount_paise is not null and cash_amount_paise > 0 then
    insert into public.payments (user_id, plan, billing_cycle, amount_paise, source, note)
      values (target_user_id, result.plan, result.billing_cycle, cash_amount_paise, 'cash', note);
  end if;

  return result;
end;
$$;

create or replace function public.admin_list_users(
  search_term text default null,
  max_rows integer default 500
)
returns table (
  user_id uuid,
  email text,
  name text,
  plan text,
  billing_cycle text,
  expires_at timestamptz,
  ocr_used integer,
  ocr_period_key text,
  created_at timestamptz
)
language plpgsql
security definer set search_path = public
as $$
begin
  return query
    select
      u.id,
      u.email::text,
      coalesce(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
      e.plan,
      e.billing_cycle,
      e.expires_at,
      e.ocr_used,
      e.ocr_period_key,
      u.created_at
    from auth.users u
    join public.entitlements e on e.user_id = u.id
    where search_term is null or trim(search_term) = ''
      or u.email ilike '%' || trim(search_term) || '%'
      or coalesce(u.raw_user_meta_data->>'name', '') ilike '%' || trim(search_term) || '%'
    order by u.created_at desc
    limit max_rows;
end;
$$;

create or replace function public.admin_expire_access(
  target_email text,
  note text default null
)
returns public.entitlements
language plpgsql
security definer set search_path = public
as $$
declare
  target_user_id uuid;
  result public.entitlements;
begin
  select id into target_user_id from auth.users where lower(email) = lower(trim(target_email));
  if target_user_id is null then
    raise exception 'user_not_found';
  end if;

  update public.entitlements
    set expires_at = now() - interval '1 minute'
    where user_id = target_user_id
    returning * into result;

  insert into public.admin_audit_log (target_email, extra_days, new_plan, action)
    values (lower(trim(target_email)), 0, null, 'expire');

  return result;
end;
$$;

create or replace function public.redeem_passcode(code text, session_token uuid)
returns public.entitlements
language plpgsql
security definer set search_path = public
as $$
declare
  normalized text := upper(trim(code));
  result public.entitlements;
begin
  if not public.check_session(session_token) then
    raise exception 'session_invalidated';
  end if;

  if normalized in ('DWIS15', 'DWISFREE', 'TRIAL15') then
    update public.entitlements
      set expires_at = greatest(expires_at, now()) + interval '15 days'
      where user_id = auth.uid()
      returning * into result;

    insert into public.payments (user_id, plan, billing_cycle, amount_paise, source, note)
      values (auth.uid(), result.plan, result.billing_cycle, 0, 'coupon', normalized);
  else
    raise exception 'invalid passcode';
  end if;

  return result;
end;
$$;

revoke all on function public.admin_lookup_user(text) from public, authenticated, anon;
revoke all on function public.admin_list_users(text, integer) from public, authenticated, anon;
revoke all on function public.admin_grant_access(text, integer, text, integer, text) from public, authenticated, anon;
revoke all on function public.admin_expire_access(text, text) from public, authenticated, anon;
revoke all on function public.apply_paid_plan(uuid, text, text, integer, integer, text, text) from public, authenticated, anon;
revoke all on function public.admin_list_payments(uuid) from public, authenticated, anon;

grant execute on function public.admin_lookup_user(text) to service_role;
grant execute on function public.admin_list_users(text, integer) to service_role;
grant execute on function public.admin_grant_access(text, integer, text, integer, text) to service_role;
grant execute on function public.admin_expire_access(text, text) to service_role;
grant execute on function public.apply_paid_plan(uuid, text, text, integer, integer, text, text) to service_role;
grant execute on function public.admin_list_payments(uuid) to service_role;
grant execute on function public.redeem_passcode(text, uuid) to authenticated;
