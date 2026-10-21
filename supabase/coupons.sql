-- Run this once in the Supabase SQL Editor. Adds admin-generated DISCOUNT
-- coupons (percent off a paid plan purchase) - separate from the hardcoded
-- trial-extend passcodes (DWIS15/DWISFREE/TRIAL15 in schema.sql/single_session.sql).
-- Each coupon can be redeemed by a given user account only once.

create table if not exists public.coupons (
  code text primary key,
  discount_percent integer not null check (discount_percent between 1 and 100),
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.coupons enable row level security;
-- No policies: this table is only ever touched by the PHP/JS backend using
-- the service_role key (bypasses RLS entirely), same as entitlements.

create table if not exists public.coupon_redemptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null references public.coupons(code) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, code)
);
alter table public.coupon_redemptions enable row level security;

-- Checks (without consuming) whether a coupon is usable by this user right
-- now - active, not expired, not already redeemed by them. Raises on any
-- failure so the backend can surface one error message.
create or replace function public.validate_coupon(p_code text, p_user_id uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  c public.coupons;
begin
  select * into c from public.coupons where code = upper(trim(p_code));
  if c is null or not c.active then
    raise exception 'invalid_coupon';
  end if;
  if c.expires_at is not null and c.expires_at <= now() then
    raise exception 'coupon_expired';
  end if;
  if exists (select 1 from public.coupon_redemptions where user_id = p_user_id and code = c.code) then
    raise exception 'coupon_already_used';
  end if;
  return c.discount_percent;
end;
$$;

-- Marks a coupon as redeemed by this user - call only after payment is
-- verified. Re-validates so a race between two near-simultaneous checkouts
-- can't both succeed.
create or replace function public.redeem_discount_coupon(p_code text, p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  normalized text := upper(trim(p_code));
begin
  perform public.validate_coupon(normalized, p_user_id);
  insert into public.coupon_redemptions (user_id, code) values (p_user_id, normalized);
end;
$$;

-- Admin: create a new coupon or update an existing one's percent/expiry
-- (re-activates it too). Called from the admin panel via the service role.
create or replace function public.admin_create_coupon(
  p_code text,
  p_discount_percent integer,
  p_expires_at timestamptz default null
)
returns public.coupons
language plpgsql
security definer set search_path = public
as $$
declare
  result public.coupons;
begin
  insert into public.coupons (code, discount_percent, expires_at, active)
    values (upper(trim(p_code)), p_discount_percent, p_expires_at, true)
    on conflict (code) do update
      set discount_percent = excluded.discount_percent,
          expires_at = excluded.expires_at,
          active = true
    returning * into result;

  -- admin_audit_log.target_email is reused to hold the coupon code here -
  -- this table started as grant/expire-only, this avoids a schema change.
  insert into public.admin_audit_log (target_email, extra_days, new_plan, action)
    values (result.code, p_discount_percent, null, 'coupon_create');

  return result;
end;
$$;

-- Admin: enable/disable a coupon without deleting its redemption history.
create or replace function public.admin_set_coupon_active(p_code text, p_active boolean)
returns public.coupons
language plpgsql
security definer set search_path = public
as $$
declare
  result public.coupons;
begin
  update public.coupons set active = p_active
    where code = upper(trim(p_code))
    returning * into result;
  if result is null then
    raise exception 'coupon_not_found';
  end if;

  insert into public.admin_audit_log (target_email, extra_days, new_plan, action)
    values (result.code, 0, null, case when p_active then 'coupon_enable' else 'coupon_disable' end);

  return result;
end;
$$;

-- Admin: list all coupons with their redemption counts.
create or replace function public.admin_list_coupons()
returns table (
  code text,
  discount_percent integer,
  active boolean,
  expires_at timestamptz,
  created_at timestamptz,
  times_redeemed bigint
)
language sql
security definer set search_path = public
as $$
  select
    c.code,
    c.discount_percent,
    c.active,
    c.expires_at,
    c.created_at,
    count(r.id)
  from public.coupons c
  left join public.coupon_redemptions r on r.code = c.code
  group by c.code, c.discount_percent, c.active, c.expires_at, c.created_at
  order by c.created_at desc;
$$;
