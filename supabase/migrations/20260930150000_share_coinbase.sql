-- Sharing Coinbase with the household.
--
-- Coinbase loads live, with its owner's own access, and a household never
-- uses anyone's access. So, like a bank, what the household sees is a stored
-- copy: here, only Coinbase's total value (sealed, opened only by the app),
-- written on the owner's own visits. Nobody else's visit ever touches the
-- owner's Coinbase.
--
-- The copy exists only while the owner shares Coinbase. A copy can't be
-- written without a share (the trigger below blanks it), stopping the share
-- wipes it at once, and disconnecting Coinbase stops the share, so connecting
-- it again later is private until they choose to share it again.

alter table public.coinbase_links
  add column sealed_snapshot text check (sealed_snapshot is null or char_length(sealed_snapshot) between 29 and 4000),
  add column snapshot_at timestamptz;

-- Coinbase, like something added by hand, has no bank connection.
alter table public.shared_accounts drop constraint shared_accounts_check;
alter table public.shared_accounts add constraint shared_accounts_connection
  check (((account_id like 'manual-%') or account_id = 'coinbase') = (item_id is null));

-- No copy without a share.
create function public.coinbase_snapshot_needs_share() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.sealed_snapshot is not null
     and not exists (select 1 from public.shared_accounts s where s.user_id = new.user_id and s.account_id = 'coinbase') then
    new.sealed_snapshot := null;
    new.snapshot_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.coinbase_snapshot_needs_share() from public, anon, authenticated;
create trigger coinbase_snapshot_needs_share before insert or update on public.coinbase_links
  for each row execute function public.coinbase_snapshot_needs_share();

-- Stop sharing (or leave the household): the copy goes at once.
create function public.coinbase_unshared() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.coinbase_links c set sealed_snapshot = null, snapshot_at = null where c.user_id = old.user_id and c.sealed_snapshot is not null;
  return null;
end;
$$;
revoke all on function public.coinbase_unshared() from public, anon, authenticated;
create trigger coinbase_unshared after delete on public.shared_accounts
  for each row when (old.account_id = 'coinbase') execute function public.coinbase_unshared();

-- Disconnect Coinbase: its share goes too, so a later reconnect starts private.
create function public.coinbase_disconnected() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.shared_accounts s where s.user_id = old.user_id and s.account_id = 'coinbase';
  return null;
end;
$$;
revoke all on function public.coinbase_disconnected() from public, anon, authenticated;
create trigger coinbase_disconnected after delete on public.coinbase_links
  for each row execute function public.coinbase_disconnected();

-- The other members' shared money, now with a shared Coinbase's stored value.
-- Also: someone's hand-added items are returned only when they share one of
-- THEM ("manual-…"), never merely because they share something else without
-- a bank connection (Coinbase).
drop function public.household_shared_money();
create function public.household_shared_money() returns table (
  user_id uuid,
  first_name text,
  shared_account_ids text[],
  sealed_category_rules text,
  sealed_manual_items text,
  items jsonb,
  coinbase jsonb
)
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := public.household_caller();
begin
  return query
    select
      m.user_id,
      p.first_name,
      (select array_agg(s.account_id order by s.account_id) from public.shared_accounts s where s.user_id = m.user_id),
      case when exists (select 1 from public.shared_accounts s where s.user_id = m.user_id and s.item_id is not null) then p.sealed_category_rules end,
      case when exists (select 1 from public.shared_accounts s where s.user_id = m.user_id and s.account_id like 'manual-%') then p.sealed_manual_items end,
      coalesce(
        (select jsonb_agg(jsonb_build_object('item_id', i.item_id, 'institution_name', i.institution_name, 'sealed_sync', i.sealed_sync, 'synced_at', i.synced_at) order by i.item_id)
         from public.plaid_items i
         where i.user_id = m.user_id and i.item_id in (select s.item_id from public.shared_accounts s where s.user_id = m.user_id and s.item_id is not null)),
        '[]'::jsonb
      ),
      (select jsonb_build_object('sealed', c.sealed_snapshot, 'at', c.snapshot_at)
       from public.coinbase_links c
       where c.user_id = m.user_id and c.sealed_snapshot is not null
         and exists (select 1 from public.shared_accounts s where s.user_id = m.user_id and s.account_id = 'coinbase'))
    from public.household_members m
    left join public.profiles p on p.user_id = m.user_id
    where m.household_id = public.my_household()
      and m.user_id <> me
      and exists (select 1 from public.shared_accounts s where s.user_id = m.user_id);
end;
$$;
revoke all on function public.household_shared_money() from public, anon;
grant execute on function public.household_shared_money() to authenticated;
