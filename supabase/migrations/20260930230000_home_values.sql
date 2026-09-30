-- Home values from RentCast, inside a hard cap.
--
-- RentCast bills every request past the plan's allowance, so Prism never asks
-- more often than the owner has agreed to pay for. The cap is enforced HERE,
-- by the one function allowed to approve a lookup, not by the app's good
-- behaviour:
--   * at most `home_value_lookups_31_days` lookups in ANY 31 days, across
--     everyone: a rolling window, so no billing month can hold more, whenever
--     RentCast's starts;
--   * at most `home_value_lookups_per_person_31_days` a person in 31 days, and
--     each home at most once a calendar month;
--   * never for a connected app, and never before the person's second step.
-- The app calls RentCast only when this answers 'ok'. The global log holds
-- nothing but times and keeps 62 days of them, and deleting an account never
-- touches it, so nobody frees room under the cap by leaving. A missing limit
-- counts as zero: the function fails closed.
--
-- A home is counted by a random key kept (sealed) with it in the person's own
-- account, never by its name or address. Nothing here says where anyone lives.
--
-- The address itself is SEALED on the person's own profile, in a column of its
-- own: sealed_manual_items travels to household members when a person shares
-- anything they added by hand (household_shared_money), and an address must
-- never travel with it. The profile's policies govern the column: only its
-- owner reads or writes it, a connected app can read it and never write it,
-- and a session that hasn't passed two-step sign-in gets nothing.

alter table public.profiles
  add column sealed_home_values text check (sealed_home_values is null or char_length(sealed_home_values) between 29 and 20000);

comment on column public.profiles.sealed_home_values is
  'The address of each home whose value RentCast keeps up to date, the random key its lookups are counted by, and the last estimate''s range; sealed with the app''s vault key. Ciphertext only; null when there are none. Never shared with a household.';

create table public.app_limits (
  name text primary key,
  value integer not null check (value >= 0)
);
alter table public.app_limits enable row level security;
revoke all on public.app_limits from anon, authenticated;
-- 45 of the free plan's 50 a month, leaving room for the owner's own checks.
-- Raise it when the plan grows (Foundation: 1,000), with the plan, never before.
insert into public.app_limits (name, value) values
  ('home_value_lookups_31_days', 45),
  ('home_value_lookups_per_person_31_days', 3);

create table public.home_value_calls (
  at timestamptz not null default now()
);
create index home_value_calls_at on public.home_value_calls (at);
alter table public.home_value_calls enable row level security;
revoke all on public.home_value_calls from anon, authenticated;

create table public.home_value_lookups (
  user_id uuid not null references auth.users (id) on delete cascade,
  home_key uuid not null,
  month date not null,
  at timestamptz not null default now(),
  primary key (user_id, home_key, month)
);
create index home_value_lookups_user_at on public.home_value_lookups (user_id, at);
alter table public.home_value_lookups enable row level security;
revoke all on public.home_value_lookups from anon, authenticated;

create function public.claim_home_value_lookup(p_home_key uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  this_month date := date_trunc('month', now() at time zone 'utc')::date;
  person_cap integer;
  total_cap integer;
begin
  if uid is null or p_home_key is null then return 'refused'; end if;
  if (auth.jwt() ->> 'client_id') is not null then return 'refused'; end if;
  if public.second_step_pending() then return 'refused'; end if;
  -- One decision at a time, so two requests can't both take the last place.
  perform pg_advisory_xact_lock(hashtext('public.claim_home_value_lookup'));
  if exists (select 1 from public.home_value_lookups l where l.user_id = uid and l.home_key = p_home_key and l.month = this_month) then
    return 'already';
  end if;
  select l.value into person_cap from public.app_limits l where l.name = 'home_value_lookups_per_person_31_days';
  if (select count(*) from public.home_value_lookups l where l.user_id = uid and l.at > now() - interval '31 days') >= coalesce(person_cap, 0) then
    return 'person-limit';
  end if;
  select l.value into total_cap from public.app_limits l where l.name = 'home_value_lookups_31_days';
  if (select count(*) from public.home_value_calls c where c.at > now() - interval '31 days') >= coalesce(total_cap, 0) then
    return 'limit';
  end if;
  insert into public.home_value_calls default values;
  insert into public.home_value_lookups (user_id, home_key, month) values (uid, p_home_key, this_month);
  delete from public.home_value_calls c where c.at < now() - interval '62 days';
  return 'ok';
end;
$$;
revoke all on function public.claim_home_value_lookup(uuid) from public, anon, authenticated;
grant execute on function public.claim_home_value_lookup(uuid) to authenticated;
