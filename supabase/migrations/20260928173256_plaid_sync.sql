-- Bank sync that remembers where it left off (roadmap item 2).
--
-- Each linked bank keeps Plaid's sync cursor and the transactions synced so
-- far, packed and SEALED with PRISM_VAULT_KEY like its access token — the
-- database holds ciphertext only, never a merchant or an amount. A page load
-- asks Plaid only for what changed since the cursor, and only when Plaid said
-- something changed or the copy is getting old.
--
-- sync_version guards the save: a sync lands only if the version it started
-- from is still current, so two tabs can't overwrite a newer copy with an
-- older one. synced_at is when the saved sync STARTED, so a change Plaid
-- announces mid-sync is still picked up next time.

alter table public.plaid_items
  add column sealed_sync text check (sealed_sync is null or char_length(sealed_sync) between 29 and 16000000),
  add column sync_version integer not null default 0 check (sync_version >= 0),
  add column synced_at timestamptz,
  -- Plaid said this bank has news (its webhook), and the next visit should sync.
  add column changed_at timestamptz;

-- The one thing Plaid's webhook may do, and nothing more: say "this bank has
-- news". There is no privileged key in Prism, so the webhook can't sync on
-- the person's behalf (and must not: it would need their bank token); it
-- stamps changed_at, and the person's own next visit does the sync as them.
-- The app verifies Plaid's signature before calling this; even unverified,
-- the worst a caller who knew an item id could do is cause an early sync.
create function public.plaid_item_changed(p_item_id text) returns void
language sql security definer set search_path = '' as $$
  update public.plaid_items set changed_at = now()
  where p_item_id ~ '^[A-Za-z0-9_-]{1,200}$' and item_id = p_item_id
$$;
revoke all on function public.plaid_item_changed(text) from public, authenticated;
grant execute on function public.plaid_item_changed(text) to anon;
comment on function public.plaid_item_changed(text) is
  'Plaid webhook only: marks a linked bank as having news. Touches changed_at and nothing else; returns nothing.';
