-- What a person adds to their own transactions (src/lib/finance/details.ts):
-- how a line splits across categories, their own tags, and who owes them for
-- it (a name and an amount), by bank transaction id.
--
-- Tags and names are the person's own words about their money, so they are
-- SEALED with PRISM_VAULT_KEY (gzip + AES-256-GCM, "z1." or "z2.<key id>.")
-- like the category fixes and payment notes beside them: the database holds
-- ciphertext only. The column lives on the person's own profile row, so the
-- profile's policies already govern it: only its owner reads or writes it, a
-- connected app can read it and never write it, a session that hasn't passed
-- two-step sign-in gets nothing, and no household function names it.

alter table public.profiles
  add column sealed_txn_details text check (sealed_txn_details is null or char_length(sealed_txn_details) between 29 and 1000000);

comment on column public.profiles.sealed_txn_details is
  'Splits, tags and who owes the person, by bank transaction, sealed with the app''s vault key. Ciphertext only; null when there are none.';

-- The morning check draws the person's money exactly as a visit does, so a
-- bill they split counts in its parts in their alert email too: the job's
-- sources now carry the sealed details. Same signature, so the function's
-- grants and comment stand; everything else it returns is unchanged.
create or replace function public.alerts_sources(p_secret text, p_user_id uuid) returns jsonb
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
    'sealed_txn_details', p.sealed_txn_details,
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
