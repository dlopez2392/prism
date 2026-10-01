-- Alerts on a phone: Web Push, alongside alert emails.
--
-- A browser a person lets Prism notify hands over a subscription: its push
-- service's address for that browser, and two keys to encrypt messages to it
-- (RFC 8291), so the push service (Apple's, Google's, Mozilla's, Microsoft's)
-- carries what it can't read. Prism keeps each one sealed with
-- PRISM_VAULT_KEY, named in the clear only by the sha256 of its address and
-- the kind of device, and only while the person's alert emails are on: a push
-- is the same news as the email, sent by the same daily job the moment the
-- email goes. Five devices at most.
--
-- The job reaches them only through two functions that answer to its secret
-- (alert_job_allowed, migration alert_emails):
--
--   push_due      the sealed subscriptions of everyone with alerts on.
--   push_forget   deletes one its push service says no longer exists, or that
--                 no key in the ring opens any more.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint_hash text not null check (endpoint_hash ~ '^[0-9a-f]{64}$'),
  sealed text not null check (char_length(sealed) between 29 and 4000),
  device text not null check (device in ('iPhone', 'iPad', 'Android', 'Mac', 'Windows', 'Linux', 'ChromeOS', 'Other')),
  created_at timestamptz not null default now(),
  unique (user_id, endpoint_hash)
);
comment on table public.push_subscriptions is
  'Devices a person lets Prism notify (Web Push subscriptions), sealed with the app''s vault key. Kept only while their alert emails are on; five at most.';

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;

create policy "own devices: read" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "own devices: add" on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.alert_email));
create policy "own devices: replace" on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.alert_email));
create policy "own devices: remove" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

-- A connected app has no use for them: it neither reads nor writes one.
create policy "connected apps: none" on public.push_subscriptions as restrictive for all to authenticated
  using (((select auth.jwt()) ->> 'client_id') is null) with check (((select auth.jwt()) ->> 'client_id') is null);
create policy "second step: passed" on public.push_subscriptions as restrictive for all to authenticated
  using (not (select public.second_step_pending())) with check (not (select public.second_step_pending()));

-- Five devices a person, counted before the row lands. Saving a device again
-- (an upsert of the same address) is never refused: it isn't a sixth.
create function public.push_subscriptions_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id and s.endpoint_hash = new.endpoint_hash)
     and (select count(*) from public.push_subscriptions s where s.user_id = new.user_id) >= 5 then
    raise exception 'five devices at most' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.push_subscriptions_limit() from public, anon, authenticated;
create trigger push_subscriptions_limit before insert on public.push_subscriptions
  for each row execute function public.push_subscriptions_limit();

-- Turning alert emails off forgets the devices too, at once: nothing is kept
-- for a job that won't run for them. (Same trigger, profiles_forget_alerts.)
create or replace function public.forget_alert_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.alert_snapshots s where s.user_id = new.user_id;
  delete from public.push_subscriptions s where s.user_id = new.user_id;
  return new;
end $$;
revoke all on function public.forget_alert_snapshot() from public, anon, authenticated;

create function public.push_due(p_secret text)
returns table (user_id uuid, id uuid, sealed text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.alert_job_allowed(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select s.user_id, s.id, s.sealed
    from public.push_subscriptions s
    join public.profiles p on p.user_id = s.user_id
    where p.alert_email;
end $$;

create function public.push_forget(p_secret text, p_user_id uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.alert_job_allowed(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.push_subscriptions s where s.id = p_id and s.user_id = p_user_id;
end $$;

revoke all on function public.push_due(text) from public, authenticated;
revoke all on function public.push_forget(text, uuid, uuid) from public, authenticated;
grant execute on function public.push_due(text) to anon;
grant execute on function public.push_forget(text, uuid, uuid) to anon;
comment on function public.push_due(text) is 'Alert job only (answers to its secret): the sealed device subscriptions of everyone with alerts on.';
comment on function public.push_forget(text, uuid, uuid) is 'Alert job only: forgets a device its push service says is gone.';
