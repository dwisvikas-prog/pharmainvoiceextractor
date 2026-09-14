-- Run this once in the Supabase SQL Editor for your project.
-- Creates the entitlements table (plan, trial expiry, OCR usage) and
-- locks it down so users can only read their own row directly; trial
-- creation and passcode redemption happen through security-definer
-- functions so the logic/codes never live in client-side JS.

create table if not exists public.entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'trial' check (plan in ('trial', 'basic', 'pro')),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'yearly')),
  expires_at timestamptz not null,
  ocr_used integer not null default 0,
  ocr_period_key text not null,
  created_at timestamptz not null default now()
);

alter table public.entitlements enable row level security;

create policy "read own entitlements"
  on public.entitlements for select
  using (auth.uid() = user_id);
-- No insert/update policy for the table itself: all writes go through the
-- functions below, so plan/expiry/usage can't be edited directly from the
-- browser (e.g. via devtools calling the Supabase client).

-- Auto-create a 15-day trial row whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.entitlements (user_id, plan, billing_cycle, expires_at, ocr_used, ocr_period_key)
  values (new.id, 'trial', 'monthly', now() + interval '15 days', 0, to_char(now(), 'YYYY-MM'));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Trial-extension passcode lives here, not in client JS. Paid-plan codes are
-- deliberately NOT included here yet: there's no payment gateway wired up,
-- so a self-service "type a code, get Premium" path would just be a free
-- upgrade exploit. Add plan-granting logic here later, triggered from a
-- verified payment webhook - not from a code the user types in.
create or replace function public.redeem_passcode(code text)
returns public.entitlements
language plpgsql
security definer set search_path = public
as $$
declare
  normalized text := upper(trim(code));
  result public.entitlements;
begin
  if normalized in ('DWIS15', 'DWISFREE', 'TRIAL15') then
    update public.entitlements
      set expires_at = greatest(expires_at, now()) + interval '15 days'
      where user_id = auth.uid()
      returning * into result;
  else
    raise exception 'invalid passcode';
  end if;

  return result;
end;
$$;

-- Server-checked OCR usage increment (can't be reset by editing localStorage).
create or replace function public.record_ocr_pages(pages integer)
returns public.entitlements
language plpgsql
security definer set search_path = public
as $$
declare
  current_period text := to_char(now(), 'YYYY-MM');
  result public.entitlements;
begin
  update public.entitlements
    set ocr_used = case when ocr_period_key = current_period then ocr_used + pages else pages end,
        ocr_period_key = current_period
    where user_id = auth.uid()
    returning * into result;
  return result;
end;
$$;

grant execute on function public.redeem_passcode(text) to authenticated;
grant execute on function public.record_ocr_pages(integer) to authenticated;
