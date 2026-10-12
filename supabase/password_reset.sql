-- Run this once in the Supabase SQL Editor, after exclusive_login.sql.
--
-- Password reset needs to free this account's single-session lock
-- (active_session_token in entitlements) once the password has been
-- changed, so the user can log back in immediately on any device instead
-- of hitting "session_active_elsewhere". Unlike release_session(), this
-- doesn't need to match a specific token - it just clears whatever is
-- there for the currently authenticated user (auth.uid()), which is safe
-- to call right after supabase.auth.updateUser({ password }) succeeds.
create or replace function public.force_release_session()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.entitlements
    set active_session_token = null, last_seen_at = null
    where user_id = auth.uid();
end;
$$;

grant execute on function public.force_release_session() to authenticated;
