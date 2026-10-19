-- Run this AFTER daily_ocr_limit.sql and admin_and_payments.sql, once, in the
-- Supabase SQL Editor. Adds today's OCR usage (ocr_used_today/ocr_day_key)
-- to the admin lookup/list functions so the admin panel can show it.

drop function if exists public.admin_lookup_user(text);

create or replace function public.admin_lookup_user(target_email text)
returns table (
  user_id uuid,
  email text,
  name text,
  plan text,
  billing_cycle text,
  expires_at timestamptz,
  ocr_used integer,
  ocr_period_key text,
  ocr_used_today integer,
  ocr_day_key text
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
      e.ocr_used_today,
      e.ocr_day_key
    from auth.users u
    join public.entitlements e on e.user_id = u.id
    where lower(u.email) = lower(trim(target_email));
end;
$$;

drop function if exists public.admin_list_users(text, integer);

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
  ocr_used_today integer,
  ocr_day_key text,
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
      e.ocr_used_today,
      e.ocr_day_key,
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
