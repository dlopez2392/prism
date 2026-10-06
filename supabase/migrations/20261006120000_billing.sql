-- Prism Plus: what each person pays for, as Stripe last said.
--
-- Stripe is the record of who pays (src/lib/billing). This table is Prism's
-- copy of it, one row a person for each Stripe mode (test or live, so a trial
-- run with test keys never counts once the live keys go in), written ONLY by
-- billing_record below. That function answers to the server's job secret
-- (alert_job_allowed: CRON_SECRET, whose sha256 is in job_keys and which only
-- the production server holds), and the server calls it only with what it has
-- just read from Stripe itself: after a Stripe webhook whose signature checks
-- out, or on the person's return from paying. Nobody can write a row over the
-- API, so nobody can make themselves a subscriber; a person may read their
-- own.
--
-- Nothing here is about money in the bank: a customer id, a plan, a status
-- and a few dates. The card itself never reaches Prism; Stripe keeps it.
--
-- Who gets Prism Plus (billing_counts, the one rule): a subscription that is
-- trialing, active or past due (Stripe still retrying a card), until a week
-- past the end of the period it last paid for, in case Stripe's word that it
-- ended never arrives. Everyone in a household gets Plus from one member's
-- Household plan. The household's own view also opens for everyone in it
-- while any member pays for either plan.

create table public.billing (
  user_id uuid not null references auth.users (id) on delete cascade,
  livemode boolean not null,
  customer_id text not null unique check (customer_id ~ '^cus_[A-Za-z0-9]{1,100}$'),
  subscription_id text not null check (subscription_id ~ '^sub_[A-Za-z0-9]{1,100}$'),
  subscription_created timestamptz not null,
  plan text not null check (plan in ('plus', 'household')),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  status text not null check (status in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  period_end timestamptz,
  trial_end timestamptz,
  -- When it stops, if it's been cancelled (at the period's end, or on a date); null while it renews.
  ends_at timestamptz,
  -- When the server read this from Stripe: an older reading never replaces a newer one.
  stripe_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, livemode)
);
comment on table public.billing is
  'Prism Plus: each person''s Stripe subscription as Stripe last said, per Stripe mode. Written only by billing_record (the server, holding the job secret).';

alter table public.billing enable row level security;
revoke all on public.billing from anon;
revoke insert, update, delete, truncate, references, trigger on public.billing from authenticated;
create policy "own plan: read" on public.billing for select to authenticated using (user_id = (select auth.uid()));
create policy "second step: passed" on public.billing as restrictive for all to authenticated
  using ((((select auth.jwt()) ->> 'client_id') is not null) or not (select public.second_step_pending()));

create trigger billing_touch before update on public.billing for each row execute function public.touch_updated_at();

-- The one rule for whether a subscription gives Prism Plus right now.
create function public.billing_counts(p_status text, p_period_end timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(p_status in ('trialing', 'active', 'past_due') and (p_period_end is null or p_period_end > now() - interval '7 days'), false)
$$;
revoke all on function public.billing_counts(text, timestamptz) from public, anon, authenticated;

-- What the signed-in person has, for the server to decide what they may use:
-- their own subscription, and whether their household's gives them Plus (a
-- member's Household plan) or its shared view (any member's plan). About the
-- other members it says only those two yeses or nos. A connected app may ask
-- too (Prism's AI connector is part of Plus); a session short of its second
-- step may not.
create function public.my_plan(p_livemode boolean)
returns table (
  plan text, billing_interval text, status text, period_end timestamptz, trial_end timestamptz, ends_at timestamptz, customer_id text, subscription_id text,
  own_plus boolean, household_plan boolean, household_plus boolean, subscribed_before boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if (auth.jwt() ->> 'client_id') is null and public.second_step_pending() then
    raise exception 'finish two-step sign-in first' using errcode = '42501';
  end if;
  return query
    with mine as (
      select b.* from public.billing b where b.user_id = me and b.livemode = p_livemode
    ), members as (
      select b.plan as p, public.billing_counts(b.status, b.period_end) as ok
      from public.household_members m
      join public.billing b on b.user_id = m.user_id and b.livemode = p_livemode
      where m.household_id = public.my_household()
    )
    select mine.plan, mine.billing_interval, mine.status, mine.period_end, mine.trial_end, mine.ends_at, mine.customer_id, mine.subscription_id,
      public.billing_counts(mine.status, mine.period_end),
      exists (select 1 from members where members.ok and members.p = 'household'),
      exists (select 1 from members where members.ok),
      mine.user_id is not null
    from (select 1) as one left join mine on true;
end $$;
revoke all on function public.my_plan(boolean) from public, anon;
grant execute on function public.my_plan(boolean) to authenticated;
comment on function public.my_plan(boolean) is
  'The caller''s Prism Plus: their own subscription, and two yeses or nos about their household''s. Nothing else about anyone.';

-- Recording what Stripe said, for the server only (it holds the job secret).
-- A reading older than the one kept is ignored, and so is any reading of a
-- subscription older than the one kept, so a late word about a subscription
-- someone replaced can never undo the new one. Returns what it did:
-- 'recorded', 'older', or 'no-person' (the account was deleted meanwhile).
create function public.billing_record(
  p_secret text, p_user_id uuid, p_livemode boolean, p_customer_id text, p_subscription_id text, p_created timestamptz,
  p_plan text, p_interval text, p_status text, p_period_end timestamptz, p_trial_end timestamptz, p_ends_at timestamptz, p_at timestamptz
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  was public.billing;
begin
  if not public.alert_job_allowed(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_at is null or p_at > now() + interval '5 minutes' or p_created is null then
    raise exception 'not a reading' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    return 'no-person';
  end if;
  -- One recording a person at a time, so two arriving together can't land out of order.
  perform pg_advisory_xact_lock(hashtextextended('billing:' || p_user_id::text, 0));
  select * into was from public.billing b where b.user_id = p_user_id and b.livemode = p_livemode;
  if found then
    if was.subscription_id = p_subscription_id then
      if p_at < was.stripe_at then
        return 'older';
      end if;
    elsif p_created < was.subscription_created then
      return 'older';
    end if;
  end if;
  insert into public.billing as b (user_id, livemode, customer_id, subscription_id, subscription_created, plan, billing_interval, status, period_end, trial_end, ends_at, stripe_at)
  values (p_user_id, p_livemode, p_customer_id, p_subscription_id, p_created, p_plan, p_interval, p_status, p_period_end, p_trial_end, p_ends_at, p_at)
  on conflict (user_id, livemode) do update set
    customer_id = excluded.customer_id, subscription_id = excluded.subscription_id, subscription_created = excluded.subscription_created,
    plan = excluded.plan, billing_interval = excluded.billing_interval, status = excluded.status, period_end = excluded.period_end,
    trial_end = excluded.trial_end, ends_at = excluded.ends_at, stripe_at = excluded.stripe_at;
  return 'recorded';
end $$;
revoke all on function public.billing_record(text, uuid, boolean, text, text, timestamptz, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz) from public, authenticated;
grant execute on function public.billing_record(text, uuid, boolean, text, text, timestamptz, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz) to anon;
comment on function public.billing_record(text, uuid, boolean, text, text, timestamptz, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz) is
  'Server only (answers to the job secret): records a person''s Stripe subscription as Stripe just said. Never an older reading over a newer one.';

-- Whether one person has Prism Plus: their own subscription, or a Household
-- plan paid for by someone in their household. Only the definer functions
-- below ask it.
create function public.billing_plus(p_user_id uuid, p_livemode boolean) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.billing b
    where b.user_id = p_user_id and b.livemode = p_livemode and public.billing_counts(b.status, b.period_end)
  ) or exists (
    select 1 from public.household_members m
    join public.household_members o on o.household_id = m.household_id
    join public.billing b on b.user_id = o.user_id and b.livemode = p_livemode and b.plan = 'household'
    where m.user_id = p_user_id and public.billing_counts(b.status, b.period_end)
  )
$$;
revoke all on function public.billing_plus(uuid, boolean) from public, anon, authenticated;

-- The alert job sends only to people with Prism Plus: it asks this, with its
-- secret, which of the people with alert emails on that is. Ids only.
create function public.alerts_plus(p_secret text, p_livemode boolean) returns table (user_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.alert_job_allowed(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query select p.user_id from public.profiles p where p.alert_email and public.billing_plus(p.user_id, p_livemode);
end $$;
revoke all on function public.alerts_plus(text, boolean) from public, authenticated;
grant execute on function public.alerts_plus(text, boolean) to anon;
comment on function public.alerts_plus(text, boolean) is
  'Alert job only (answers to its secret): which people with alert emails on have Prism Plus. Ids only.';

-- A calendar that keeps itself up to date is part of Prism Plus, and a
-- calendar app never signs in: like calendar_feed_snapshot, this answers
-- only the exact sha256 of a feed's secret, and only yes or no.
create function public.calendar_feed_plus(p_token_hash text, p_livemode boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.calendar_feeds f
    where p_token_hash ~ '^[0-9a-f]{64}$' and f.token_hash = p_token_hash and public.billing_plus(f.user_id, p_livemode)
  )
$$;
revoke all on function public.calendar_feed_plus(text, boolean) from public, authenticated;
grant execute on function public.calendar_feed_plus(text, boolean) to anon;
comment on function public.calendar_feed_plus(text, boolean) is
  'Anon-only by design: exact sha256 of a feed secret -> whether that feed''s owner has Prism Plus. Nothing else.';
