-- Email alerts: opt-in, per person, sent by a daily job (src/app/api/cron/alerts).
--
-- Prism holds no service-role key, so the job can't read anyone's data as
-- itself. Instead it calls three functions that answer only to the job's
-- secret: Vercel keeps the secret (CRON_SECRET, Production only); this
-- database keeps only its sha256 (job_keys, which nobody can read or write
-- over the API; the operator sets it once from the SQL editor). With the
-- secret, a caller gets what an alert email needs, for the people who asked
-- for one, and nothing else:
--
--   alerts_due     each opted-in person's address, time zone and choices, the
--                  sealed snapshot their last visit left, their banks'
--                  warnings, and the fingerprints of what was already sent.
--   alerts_sent    records fingerprints, so news goes once.
--   alerts_stop    turns a person's emails off (the unsubscribe link).
--
-- The snapshot is sealed with PRISM_VAULT_KEY like everything else that
-- describes money; a fingerprint is a sha256 of the person and the alert's
-- occasion, so the delivery log names no merchant. Without the vault key the
-- secret opens nothing but email addresses, choices, and which banks have
-- asked their owner to sign in again.

alter table public.profiles
  add column alert_email boolean not null default false,
  add column alert_kinds text[] not null default array['bank', 'bill-short', 'price-rise', 'weekly']::text[]
    check (alert_kinds <@ array['bank', 'bill-short', 'price-rise', 'weekly']::text[]),
  add column alert_amounts boolean not null default true;

comment on column public.profiles.alert_email is 'Whether the person asked for alert emails. Off until they turn it on.';
comment on column public.profiles.alert_kinds is 'Which alerts they want: bank, bill-short, price-rise, weekly.';
comment on column public.profiles.alert_amounts is 'Whether their alert emails may show dollar amounts.';

-- What the person's last visit found, for the job: a row of its own, so a
-- visit that leaves one never moves profiles.updated_at, which guards the
-- profile's other writes. Only while their emails are on: it can't be written
-- otherwise, and turning them off deletes it.
create table public.alert_snapshots (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sealed text not null check (char_length(sealed) between 29 and 40000),
  updated_at timestamptz not null default now()
);
comment on table public.alert_snapshots is
  'What a person''s last visit found worth an alert, and the week''s numbers, for the email job; sealed with the app''s vault key. Kept only while their alert emails are on.';

alter table public.alert_snapshots enable row level security;
revoke all on public.alert_snapshots from anon;

create policy "own alert snapshot: read" on public.alert_snapshots for select to authenticated using (user_id = (select auth.uid()));
create policy "own alert snapshot: add" on public.alert_snapshots for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.alert_email));
create policy "own alert snapshot: replace" on public.alert_snapshots for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.alert_email));
create policy "own alert snapshot: remove" on public.alert_snapshots for delete to authenticated using (user_id = (select auth.uid()));

-- A connected app has no use for it: it neither reads nor writes one.
create policy "connected apps: none" on public.alert_snapshots as restrictive for all to authenticated
  using (((select auth.jwt()) ->> 'client_id') is null) with check (((select auth.jwt()) ->> 'client_id') is null);
create policy "second step: passed" on public.alert_snapshots as restrictive for all to authenticated
  using (not (select public.second_step_pending())) with check (not (select public.second_step_pending()));

create trigger alert_snapshots_touch before update on public.alert_snapshots for each row execute function public.touch_updated_at();

-- Turning emails off drops the snapshot at once: nothing is kept for a job that won't run for them.
create function public.forget_alert_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.alert_snapshots s where s.user_id = new.user_id;
  return new;
end $$;
revoke all on function public.forget_alert_snapshot() from public, anon, authenticated;
create trigger profiles_forget_alerts after update of alert_email on public.profiles
  for each row when (old.alert_email and not new.alert_email) execute function public.forget_alert_snapshot();

create table public.alert_deliveries (
  user_id uuid not null references auth.users (id) on delete cascade,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  sent_at timestamptz not null default now(),
  primary key (user_id, fingerprint)
);
comment on table public.alert_deliveries is 'Which alerts were emailed to whom, by fingerprint only, for 120 days. Only the email job''s functions touch it.';
alter table public.alert_deliveries enable row level security;
revoke all on public.alert_deliveries from anon, authenticated;

create table public.job_keys (
  name text primary key check (name ~ '^[a-z_]{1,40}$'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$')
);
comment on table public.job_keys is 'The sha256 of each scheduled job''s secret (the secret itself lives in Vercel). Set from the SQL editor only.';
alter table public.job_keys enable row level security;
revoke all on public.job_keys from anon, authenticated;

create function public.alert_job_allowed(p_secret text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(char_length(p_secret) between 32 and 200, false)
    and exists (select 1 from public.job_keys k where k.name = 'alerts' and k.sha256 = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex'))
$$;
revoke all on function public.alert_job_allowed(text) from public, anon, authenticated;

create function public.alerts_due(p_secret text)
returns table (user_id uuid, email text, time_zone text, kinds text[], amounts boolean, sealed text, snapshot_at timestamptz, banks jsonb, sent text[])
language plpgsql security definer set search_path = '' as $$
begin
  if not public.alert_job_allowed(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- Every daily run keeps the delivery log to its 120 days, whether or not anything is sent.
  delete from public.alert_deliveries d where d.sent_at < now() - interval '120 days';
  return query
    select p.user_id, u.email::text, p.time_zone, p.alert_kinds, p.alert_amounts, s.sealed, s.updated_at,
      coalesce((
        select jsonb_agg(jsonb_build_object('id', i.item_id, 'name', coalesce(i.institution_name, 'Your bank'), 'attention', i.attention, 'since', i.attention_at, 'disconnect_at', i.disconnect_at))
        from public.plaid_items i where i.user_id = p.user_id and i.attention is not null
      ), '[]'::jsonb),
      coalesce((select array_agg(d.fingerprint) from public.alert_deliveries d where d.user_id = p.user_id), array[]::text[])
    from public.profiles p
    join auth.users u on u.id = p.user_id
    left join public.alert_snapshots s on s.user_id = p.user_id
    where p.alert_email and u.email is not null;
end $$;

create function public.alerts_sent(p_secret text, p_user_id uuid, p_fingerprints text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.alert_job_allowed(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(array_length(p_fingerprints, 1), 0) > 50 then
    raise exception 'too many' using errcode = '22023';
  end if;
  insert into public.alert_deliveries (user_id, fingerprint)
    select p_user_id, f from unnest(p_fingerprints) as f
    where f ~ '^[0-9a-f]{64}$' and exists (select 1 from public.profiles p where p.user_id = p_user_id and p.alert_email)
  on conflict do nothing;
end $$;

create function public.alerts_stop(p_secret text, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.alert_job_allowed(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.profiles set alert_email = false where user_id = p_user_id;
end $$;

revoke all on function public.alerts_due(text) from public, authenticated;
revoke all on function public.alerts_sent(text, uuid, text[]) from public, authenticated;
revoke all on function public.alerts_stop(text, uuid) from public, authenticated;
grant execute on function public.alerts_due(text) to anon;
grant execute on function public.alerts_sent(text, uuid, text[]) to anon;
grant execute on function public.alerts_stop(text, uuid) to anon;
comment on function public.alerts_due(text) is 'Alert email job only (answers to its secret): what each opted-in person''s email needs.';
comment on function public.alerts_sent(text, uuid, text[]) is 'Alert email job only: records what was sent, by fingerprint.';
comment on function public.alerts_stop(text, uuid) is 'Alert email job only: turns a person''s alert emails off (the unsubscribe link).';
