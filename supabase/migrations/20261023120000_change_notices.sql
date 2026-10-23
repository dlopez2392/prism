-- Change notices: one email to every account about a change to the Terms or
-- the privacy policy that matters, before it takes effect (src/lib/legal-notice.ts).
--
-- Sent by the daily job (src/app/api/cron/alerts) only once the operator
-- names the notice in NOTICE_EMAIL, through two functions that answer only
-- to the job's secret, as the alert functions do (alert_job_allowed):
--
--   notice_due    each account's address and language, for the accounts the
--                 notice hasn't gone to yet, 500 at most, in a fixed order (by id)
--                 so a run that stops at its deadline picks up where it left off.
--   notice_sent   records that it went to someone, so it goes once.
--
-- The delivery log names the notice and the person, nothing else.

create table public.notice_deliveries (
  user_id uuid not null references auth.users (id) on delete cascade,
  notice text not null check (notice ~ '^[a-z0-9-]{1,40}$'),
  sent_at timestamptz not null default now(),
  primary key (user_id, notice)
);
comment on table public.notice_deliveries is 'Which change notices were emailed to whom. Only the notice functions touch it.';
alter table public.notice_deliveries enable row level security;
revoke all on public.notice_deliveries from anon, authenticated;

create function public.notice_due(p_secret text, p_notice text)
returns table (user_id uuid, email text, language text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.alert_job_allowed(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_notice is null or p_notice !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'not a notice' using errcode = '22023';
  end if;
  return query
    select u.id, u.email::text, coalesce(p.language, 'en')
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    where u.email is not null
      and not exists (select 1 from public.notice_deliveries d where d.user_id = u.id and d.notice = p_notice)
    order by u.id
    limit 500;
end $$;

create function public.notice_sent(p_secret text, p_user_id uuid, p_notice text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.alert_job_allowed(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_notice is null or p_notice !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'not a notice' using errcode = '22023';
  end if;
  insert into public.notice_deliveries (user_id, notice)
    select p_user_id, p_notice where exists (select 1 from auth.users u where u.id = p_user_id)
  on conflict do nothing;
end $$;

revoke all on function public.notice_due(text, text) from public, authenticated;
revoke all on function public.notice_sent(text, uuid, text) from public, authenticated;
grant execute on function public.notice_due(text, text) to anon;
grant execute on function public.notice_sent(text, uuid, text) to anon;
comment on function public.notice_due(text, text) is 'Change-notice email only (answers to the job''s secret): who a notice hasn''t reached yet, with their address and language.';
comment on function public.notice_sent(text, uuid, text) is 'Change-notice email only: records that a notice reached someone.';
