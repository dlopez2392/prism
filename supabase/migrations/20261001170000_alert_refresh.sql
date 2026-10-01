-- The morning check (alerts step 3): before the alert email job writes to
-- someone, it may read their banks again, so the email speaks for today and
-- not for their last visit.
--
-- This is the ONE place Prism reads a bank without its owner present, so it
-- is narrow on purpose:
--   - only for people who turned alert emails on AND left "Check my banks each
--     morning" on (profiles.alert_refresh);
--   - never for someone with Coinbase linked: its refresh token works once,
--     and only their own visit may spend it;
--   - only through functions that answer to the job's secret (job_keys), like
--     the rest of the alert job, handing out SEALED values only: the job opens
--     them with the vault key, and asks Plaid for balances and new
--     transactions (accounts/get, transactions/sync), nothing else;
--   - writing back exactly two things: a bank's sealed copy, over the very
--     version it read (as a visit does), and the person's sealed snapshot.
--
-- The database alone decides whose banks may be read: the job asks
-- alerts_sources for anyone whose snapshot is old, and gets null back for
-- anyone who didn't allow it.

alter table public.profiles add column alert_refresh boolean not null default true;
comment on column public.profiles.alert_refresh is
  'With alert emails on: whether the job may read this person''s banks each morning before deciding what to send.';

-- May the job read this person's banks now?
create function public.alert_refresh_allowed(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.user_id = p_user_id and p.alert_email and p.alert_refresh)
    and not exists (select 1 from public.coinbase_links c where c.user_id = p_user_id)
$$;
revoke all on function public.alert_refresh_allowed(uuid) from public, anon, authenticated;

-- Everything a visit would read to draw the person's own money, sealed as
-- stored, except what a morning check never needs: home addresses (a home's
-- value is already in what they added by hand) and Coinbase (excluded above).
-- Null when the job may not read them.
create function public.alerts_sources(p_secret text, p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r jsonb;
begin
  if not public.alert_job_allowed(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not public.alert_refresh_allowed(p_user_id) then
    return null;
  end if;
  select jsonb_build_object(
    'time_zone', p.time_zone,
    'plan_budgets', p.plan_budgets,
    'plan_goals', p.plan_goals,
    'sealed_category_rules', p.sealed_category_rules,
    'sealed_manual_items', p.sealed_manual_items,
    'sealed_wallets', p.sealed_wallets,
    'banks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id', i.item_id, 'sealed_token', i.sealed_token, 'institution_id', i.institution_id, 'institution_name', i.institution_name,
        'linked_at', i.linked_at, 'sealed_sync', i.sealed_sync, 'sync_version', i.sync_version, 'synced_at', i.synced_at,
        'changed_at', i.changed_at, 'attention', i.attention, 'disconnect_at', i.disconnect_at))
      from public.plaid_items i where i.user_id = p.user_id
    ), '[]'::jsonb),
    'imports', coalesce((
      select jsonb_agg(jsonb_build_object('import_id', h.import_id, 'part', h.part, 'sealed', h.sealed, 'created_at', h.created_at))
      from public.imported_history h where h.user_id = p.user_id
    ), '[]'::jsonb)
  ) into r
  from public.profiles p where p.user_id = p_user_id;
  return r;
end $$;

-- A bank's new sealed copy, exactly as a visit saves one: only over the
-- version it was read from, stamped with when the read began (which must be
-- now, give or take), so it can never overwrite a newer copy.
create function public.alerts_save_sync(p_secret text, p_user_id uuid, p_item_id text, p_sealed_sync text, p_from_version integer, p_synced_at timestamptz)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if not public.alert_job_allowed(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_synced_at is null or p_synced_at < now() - interval '10 minutes' or p_synced_at > now() + interval '1 minute' then
    raise exception 'a sync is stamped with when it began' using errcode = '22023';
  end if;
  if not public.alert_refresh_allowed(p_user_id) then
    return false;
  end if;
  update public.plaid_items i
    set sealed_sync = p_sealed_sync, sync_version = p_from_version + 1, synced_at = p_synced_at
    where i.user_id = p_user_id and i.item_id = p_item_id and i.sync_version = p_from_version;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- The person's alert snapshot, rebuilt from this morning's read.
create function public.alerts_save_snapshot(p_secret text, p_user_id uuid, p_sealed text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if not public.alert_job_allowed(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not public.alert_refresh_allowed(p_user_id) then
    return false;
  end if;
  insert into public.alert_snapshots (user_id, sealed) values (p_user_id, p_sealed)
    on conflict (user_id) do update set sealed = excluded.sealed;
  get diagnostics n = row_count;
  return n = 1;
end $$;

revoke all on function public.alerts_sources(text, uuid) from public, authenticated;
revoke all on function public.alerts_save_sync(text, uuid, text, text, integer, timestamptz) from public, authenticated;
revoke all on function public.alerts_save_snapshot(text, uuid, text) from public, authenticated;
grant execute on function public.alerts_sources(text, uuid) to anon;
grant execute on function public.alerts_save_sync(text, uuid, text, text, integer, timestamptz) to anon;
grant execute on function public.alerts_save_snapshot(text, uuid, text) to anon;
comment on function public.alerts_sources(text, uuid) is 'Alert email job only: a person''s sealed sources for the morning check, when they allowed it and have no Coinbase linked.';
comment on function public.alerts_save_sync(text, uuid, text, text, integer, timestamptz) is 'Alert email job only: a bank''s new sealed copy, over the version it was read from.';
comment on function public.alerts_save_snapshot(text, uuid, text) is 'Alert email job only: the person''s alert snapshot, rebuilt from the morning check.';
