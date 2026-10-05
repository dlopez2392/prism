-- The language a person reads Prism in, for what Prism sends them while
-- they're away: alert and recap emails, and the phone notifications that go
-- with them (src/lib/alerts). Their own visits keep it in step with the page
-- (their choice on the EN | ES toggle, else their browser's language), so it
-- is never a second setting to find, and a visit only writes it when it
-- moved. English until a visit in Spanish says otherwise.
--
-- The alert job reads it through one more function that answers only to the
-- job's secret (alert_job_allowed, migration alert_emails), for the people
-- with alert emails on, and nothing else: no address, no name, no money.

alter table public.profiles
  add column language text not null default 'en' check (language in ('en', 'es'));

comment on column public.profiles.language is 'The language Prism writes to them in (en or es): the one their latest visit was in.';

create function public.alerts_languages(p_secret text)
returns table (user_id uuid, language text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.alert_job_allowed(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query select p.user_id, p.language from public.profiles p where p.alert_email;
end $$;

revoke all on function public.alerts_languages(text) from public, authenticated;
grant execute on function public.alerts_languages(text) to anon;
comment on function public.alerts_languages(text) is 'Alert job only (answers to its secret): the language each person with alert emails on reads Prism in.';
