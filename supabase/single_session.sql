-- Run this AFTER schema.sql, once, in the Supabase SQL Editor.
-- Adds Netflix-style "single active session" enforcement: logging in on a
-- new device invalidates every other device for that account.
--
-- How it works:
--   1. Every login calls claim_session(), which writes a brand-new random
--      token onto the user's row, overwriting whatever token was there.
--   2. Each device remembers the token IT was given (in localStorage, not
--      in this database - see src/utils/auth.ts).
--   3. The frontend polls check_session() periodically and before sensitive
--      actions (recording OCR usage, redeeming a passcode). If the token it
--      is holding no longer matches the row, that means a newer login
--      elsewhere overwrote it - this device gets force-logged-out.
--   4. record_ocr_pages/redeem_passcode now also verify the caller's token
--      server-side, so a kicked-out device can't keep spending OCR pages or
--      redeeming passcodes even if it ignores the frontend's logout.

create extension if not exists pgcrypto;

alter table public.entitlements
  add column if not exists active_session_token uuid;

-- Called right after login/register. Overwrites the active session token,
-- which is what invalidates every other device.
create or replace function public.claim_session()
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  new_token uuid := gen_random_uuid();
begin
  update public.entitlements
    set active_session_token = new_token
    where user_id = auth.uid();
  return new_token;
end;
$$;

-- Returns true only if the given token is still the current active one.
create or replace function public.check_session(session_token uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  current_token uuid;
begin
  select active_session_token into current_token
    from public.entitlements
    where user_id = auth.uid();
  return current_token is not null and current_token = session_token;
end;
$$;

-- Re-create record_ocr_pages so it also enforces the session token, not
-- just the frontend polling.
create or replace function public.record_ocr_pages(pages integer, session_token uuid)
returns public.entitlements
language plpgsql
security definer set search_path = public
as $$
declare
  current_period text := to_char(now(), 'YYYY-MM');
  result public.entitlements;
begin
  if not public.check_session(session_token) then
    raise exception 'session_invalidated';
  end if;

  update public.entitlements
    set ocr_used = case when ocr_period_key = current_period then ocr_used + pages else pages end,
        ocr_period_key = current_period
    where user_id = auth.uid()
    returning * into result;
  return result;
end;
$$;

-- Re-create redeem_passcode the same way.
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
  else
    raise exception 'invalid passcode';
  end if;

  return result;
end;
$$;

-- Drop the old single-argument versions so Postgres doesn't keep both
-- overloads around (the frontend now always passes a session_token).
drop function if exists public.record_ocr_pages(integer);
drop function if exists public.redeem_passcode(text);

grant execute on function public.claim_session() to authenticated;
grant execute on function public.check_session(uuid) to authenticated;
grant execute on function public.record_ocr_pages(integer, uuid) to authenticated;
grant execute on function public.redeem_passcode(text, uuid) to authenticated;
