-- Car values from VinAudit, inside a hard cap: the same shape as home values
-- (20260930230000_home_values.sql), for vehicles.
--
-- VinAudit bills every request, so Prism never asks more often than the owner
-- has agreed to pay for. The cap is enforced HERE, by the one function allowed
-- to approve a lookup, not by the app's good behaviour:
--   * at most `vehicle_value_lookups_31_days` lookups in ANY 31 days, across
--     everyone: a rolling window, so no billing month can hold more;
--   * at most `vehicle_value_lookups_per_person_31_days` a person in 31 days,
--     and each vehicle at most once a calendar month;
--   * never for a connected app, and never before the person's second step.
-- The app calls VinAudit only when this answers 'ok'. The global log holds
-- nothing but times and keeps 62 days of them, and deleting an account never
-- touches it, so nobody frees room under the cap by leaving. A missing limit
-- counts as zero: the function fails closed.
--
-- A vehicle is counted by a random key kept (sealed) with it in the person's
-- own account, never by its name or VIN.
--
-- The VIN and mileage are SEALED on the person's own profile, in a column of
-- their own, for the same reason as a home's address: sealed_manual_items
-- travels to household members when a person shares what they added by hand
-- (household_shared_money), and a VIN must never travel with it. The
-- profile's policies govern the column: only its owner reads or writes it, a
-- connected app can read it and never write it, and a session that hasn't
-- passed two-step sign-in gets nothing.

alter table public.profiles
  add column sealed_vehicle_values text check (sealed_vehicle_values is null or char_length(sealed_vehicle_values) between 29 and 20000);

comment on column public.profiles.sealed_vehicle_values is
  'The VIN and mileage of each vehicle whose value VinAudit keeps up to date, the random key its lookups are counted by, and the last estimate''s range; sealed with the app''s vault key. Ciphertext only; null when there are none. Never shared with a household.';

-- 90 of the free trial's 100 lookups, leaving room for the owner's own checks.
-- Raise it with the paid plan ($0.10 a lookup), never before.
insert into public.app_limits (name, value) values
  ('vehicle_value_lookups_31_days', 90),
  ('vehicle_value_lookups_per_person_31_days', 3);

create table public.vehicle_value_calls (
  at timestamptz not null default now()
);
create index vehicle_value_calls_at on public.vehicle_value_calls (at);
alter table public.vehicle_value_calls enable row level security;
revoke all on public.vehicle_value_calls from anon, authenticated;

create table public.vehicle_value_lookups (
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_key uuid not null,
  month date not null,
  at timestamptz not null default now(),
  primary key (user_id, vehicle_key, month)
);
create index vehicle_value_lookups_user_at on public.vehicle_value_lookups (user_id, at);
alter table public.vehicle_value_lookups enable row level security;
revoke all on public.vehicle_value_lookups from anon, authenticated;

create function public.claim_vehicle_value_lookup(p_vehicle_key uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  this_month date := date_trunc('month', now() at time zone 'utc')::date;
  person_cap integer;
  total_cap integer;
begin
  if uid is null or p_vehicle_key is null then return 'refused'; end if;
  if (auth.jwt() ->> 'client_id') is not null then return 'refused'; end if;
  if public.second_step_pending() then return 'refused'; end if;
  -- One decision at a time, so two requests can't both take the last place.
  perform pg_advisory_xact_lock(hashtext('public.claim_vehicle_value_lookup'));
  if exists (select 1 from public.vehicle_value_lookups l where l.user_id = uid and l.vehicle_key = p_vehicle_key and l.month = this_month) then
    return 'already';
  end if;
  select l.value into person_cap from public.app_limits l where l.name = 'vehicle_value_lookups_per_person_31_days';
  if (select count(*) from public.vehicle_value_lookups l where l.user_id = uid and l.at > now() - interval '31 days') >= coalesce(person_cap, 0) then
    return 'person-limit';
  end if;
  select l.value into total_cap from public.app_limits l where l.name = 'vehicle_value_lookups_31_days';
  if (select count(*) from public.vehicle_value_calls c where c.at > now() - interval '31 days') >= coalesce(total_cap, 0) then
    return 'limit';
  end if;
  insert into public.vehicle_value_calls default values;
  insert into public.vehicle_value_lookups (user_id, vehicle_key, month) values (uid, p_vehicle_key, this_month);
  delete from public.vehicle_value_calls c where c.at < now() - interval '62 days';
  return 'ok';
end;
$$;
revoke all on function public.claim_vehicle_value_lookup(uuid) from public, anon, authenticated;
grant execute on function public.claim_vehicle_value_lookup(uuid) to authenticated;
