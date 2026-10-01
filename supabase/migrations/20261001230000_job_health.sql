-- Whether the scheduled jobs ran, for the owner: the alert job records each
-- run's outcome here, and /api/health says when it last ran and whether that
-- run finished, so the production check (.github/workflows/production-check.yml)
-- opens an issue when a morning goes by without it.
--
-- One row per job, replaced by each run, so nothing piles up and nothing is
-- ever deleted. The row's report holds counts only (how many were due, sent,
-- refreshed…), never a person: job_ran takes the job's secret, and only
-- job_health reads the table for anyone else, and only the time and outcome.

create table public.job_runs (
  name text primary key check (name ~ '^[a-z_]{1,40}$'),
  ran_at timestamptz not null default now(),
  ok boolean not null,
  report jsonb not null default '{}'::jsonb check (jsonb_typeof(report) = 'object' and pg_column_size(report) < 4000)
);
comment on table public.job_runs is 'Each scheduled job''s last run: when, whether it finished, and its counts. Written only by job_ran (the job''s secret).';
alter table public.job_runs enable row level security;
revoke all on public.job_runs from anon, authenticated;

create function public.job_ran(p_secret text, p_name text, p_ok boolean, p_report jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.alert_job_allowed(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.job_runs as r (name, ran_at, ok, report)
    values (p_name, now(), p_ok, coalesce(p_report, '{}'::jsonb))
  on conflict (name) do update set ran_at = excluded.ran_at, ok = excluded.ok, report = excluded.report;
end $$;

-- When each job last ran and whether it finished: nothing about anyone, and nothing a run counted.
create function public.job_health() returns table (name text, ran_at timestamptz, ok boolean)
language sql stable security definer set search_path = '' as $$
  select r.name, r.ran_at, r.ok from public.job_runs r order by r.name
$$;

revoke all on function public.job_ran(text, text, boolean, jsonb) from public, authenticated;
grant execute on function public.job_ran(text, text, boolean, jsonb) to anon;
revoke all on function public.job_health() from public;
grant execute on function public.job_health() to anon, authenticated;
comment on function public.job_ran(text, text, boolean, jsonb) is 'Scheduled jobs only (answers to the alert job''s secret): records a run.';
comment on function public.job_health() is 'When each scheduled job last ran and whether it finished. For /api/health.';
