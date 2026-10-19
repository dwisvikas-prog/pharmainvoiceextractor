-- Run this AFTER single_session.sql, once, in the Supabase SQL Editor.
-- Adds a per-day OCR page cap on top of the existing monthly cap (see
-- VERIFY_OCR_PAGE_LIMITS / DAILY_OCR_PAGE_LIMITS in src/utils/auth.ts).
-- The daily counter resets to just today's pages the moment the day
-- changes - there is no rollover of unused quota from a previous day.

alter table public.entitlements
  add column if not exists ocr_used_today integer not null default 0,
  add column if not exists ocr_day_key text not null default to_char(now(), 'YYYY-MM-DD');

-- Re-create handle_new_user so new signups also get today's day key.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.entitlements (user_id, plan, billing_cycle, expires_at, ocr_used, ocr_period_key, ocr_used_today, ocr_day_key)
  values (new.id, 'trial', 'monthly', now() + interval '15 days', 0, to_char(now(), 'YYYY-MM'), 0, to_char(now(), 'YYYY-MM-DD'));
  return new;
end;
$$;

-- Re-create record_ocr_pages so it also tracks (but does not reject on) the
-- daily counter - the daily limit is enforced client-side via
-- isDailyOcrLimitReached(), the same pattern as the monthly ocr_used limit.
create or replace function public.record_ocr_pages(pages integer, session_token uuid)
returns public.entitlements
language plpgsql
security definer set search_path = public
as $$
declare
  current_period text := to_char(now(), 'YYYY-MM');
  current_day text := to_char(now(), 'YYYY-MM-DD');
  result public.entitlements;
begin
  if not public.check_session(session_token) then
    raise exception 'session_invalidated';
  end if;

  update public.entitlements
    set ocr_used = case when ocr_period_key = current_period then ocr_used + pages else pages end,
        ocr_period_key = current_period,
        ocr_used_today = case when ocr_day_key = current_day then ocr_used_today + pages else pages end,
        ocr_day_key = current_day
    where user_id = auth.uid()
    returning * into result;
  return result;
end;
$$;

grant execute on function public.record_ocr_pages(integer, uuid) to authenticated;
