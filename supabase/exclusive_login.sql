-- Run this AFTER schema.sql and single_session.sql, once, in the Supabase
-- SQL Editor. Changes the behavior from "new login kicks the old one out"
-- to "a second device can't log in at all while the first is still active" -
-- i.e. login itself is blocked, not just the old session.
--
-- How it works:
--   - Every active device sends a heartbeat roughly every 20 seconds
--     (via check_session, which the frontend already polls) that updates
--     last_seen_at.
--   - claim_session() (called on login) now checks: is there already an
--     active_session_token AND was it heartbeated in the last 60 seconds?
--     If yes, the login is rejected with 'session_active_elsewhere' instead
--     of taking over.
--   - If the other device closed its tab/lost connection, its heartbeat
--     goes stale after 60s and a new login is allowed again - this
--     prevents a permanent lockout from an abandoned session.
--   - Logging out explicitly (release_session) frees the slot immediately,
--     no need to wait out the 60s.

alter table public.entitlements
  add column if not exists last_seen_at timestamptz;

create or replace function public.claim_session()
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  new_token uuid := gen_random_uuid();
  existing_token uuid;
  existing_last_seen timestamptz;
begin
  select active_session_token, last_seen_at into existing_token, existing_last_seen
    from public.entitlements
    where user_id = auth.uid();

  if existing_token is not null
     and existing_last_seen is not null
     and existing_last_seen > now() - interval '60 seconds' then
    raise exception 'session_active_elsewhere';
  end if;

  update public.entitlements
    set active_session_token = new_token, last_seen_at = now()
    where user_id = auth.uid();
  return new_token;
end;
$$;

-- Now also acts as a heartbeat: every poll/action that calls this with a
-- valid token refreshes last_seen_at, keeping the lock alive.
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

  if current_token is not null and current_token = session_token then
    update public.entitlements set last_seen_at = now() where user_id = auth.uid();
    return true;
  end if;

  return false;
end;
$$;

-- Called on explicit logout so the slot frees up immediately instead of
-- waiting for the 60s heartbeat timeout. Only clears the row if the caller
-- still owns it - a device that already got locked out calling this is a
-- harmless no-op, it won't clear a newer device's claim.
create or replace function public.release_session(session_token uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.entitlements
    set active_session_token = null, last_seen_at = null
    where user_id = auth.uid() and active_session_token = session_token;
end;
$$;

grant execute on function public.claim_session() to authenticated;
grant execute on function public.check_session(uuid) to authenticated;
grant execute on function public.release_session(uuid) to authenticated;
