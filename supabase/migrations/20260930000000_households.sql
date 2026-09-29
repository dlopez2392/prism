-- Households: "yours, mine, ours" (roadmap item 4).
--
-- Up to four adults, each with their OWN Prism account, sign-in and two-step
-- code, join one household by invitation. Each person chooses which of their
-- accounts to share (nothing is shared until they do), and the others then see
-- those accounts' balances and transactions in the Household view.
--
-- Data is shared, never access. A member's bank token is never readable by
-- anyone else, through any path: the others see the owner's last STORED copy
-- (sealed, opened only by the app), and only the owner's own visits refresh
-- it. Every person's tables keep their own-rows-only policies untouched; the
-- one way to another member's money is household_shared_money() below, which
-- returns ciphertext only, never a token, and nothing at all to a connected
-- app or a session that hasn't passed two-step sign-in.
--
-- An invitation is a link the inviter sends themselves. It works once, for
-- seven days, only for a signed-in account with the email it was made for.
-- The database keeps only the sha256 of its secret.

create table public.households (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  -- One household per person.
  user_id uuid not null unique references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  invited_by uuid not null references auth.users (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320 and email = lower(email) and email like '%_@_%'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);
create index household_invites_household on public.household_invites (household_id);
create index household_invites_invited_by on public.household_invites (invited_by);

-- What a person shares with their household: account ids from their own
-- money (a bank account's id, or "manual-<id>" for something added by hand),
-- with the bank connection a bank account belongs to. An id that isn't theirs
-- matches nothing, since their share list is only ever applied to their own
-- data. item_id is what keeps a connection they share NOTHING from reaching
-- anyone: not its stored copy, and not even its bank's name.
create table public.shared_accounts (
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id text not null check (char_length(account_id) between 1 and 200),
  item_id text check (item_id is null or char_length(item_id) between 1 and 200),
  shared_at timestamptz not null default now(),
  primary key (user_id, account_id),
  -- A hand-added item has no bank connection; a bank account always has one.
  check ((account_id like 'manual-%') = (item_id is null))
);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.shared_accounts enable row level security;
revoke all on public.households, public.household_members, public.household_invites, public.shared_accounts from anon;

-- The caller's household, for the policies below. A definer function, so a
-- policy on household_members can ask it without recursing into itself.
create function public.my_household() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.household_id from public.household_members m where m.user_id = auth.uid();
$$;
revoke all on function public.my_household() from public, anon;
grant execute on function public.my_household() to authenticated;

create policy "household: members read" on public.households for select to authenticated using (id = (select public.my_household()));
create policy "household: members read" on public.household_members for select to authenticated using (household_id = (select public.my_household()));
create policy "household: members read invites" on public.household_invites for select to authenticated using (household_id = (select public.my_household()));
create policy "household: members cancel invites" on public.household_invites for delete to authenticated using (household_id = (select public.my_household()));
create policy "own shares" on public.shared_accounts for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- Sharing means sharing WITH someone: outside a household there is nothing to
-- share, so a share can't be made there and quietly go live on joining one.
create policy "shares need a household" on public.shared_accounts as restrictive for insert to authenticated with check ((select public.my_household()) is not null);
create policy "shares need a household: change" on public.shared_accounts as restrictive for update to authenticated
  using ((select public.my_household()) is not null) with check ((select public.my_household()) is not null);
-- Joining, inviting and leaving go through the functions below: there is no
-- policy that lets anyone write a membership or an invitation directly.

-- Connected apps read, never write; and nothing opens before the second step.
create policy "connected apps read only: add" on public.shared_accounts as restrictive for insert to authenticated with check (((select auth.jwt()) ->> 'client_id') is null);
create policy "connected apps read only: change" on public.shared_accounts as restrictive for update to authenticated using (((select auth.jwt()) ->> 'client_id') is null) with check (((select auth.jwt()) ->> 'client_id') is null);
create policy "connected apps read only: remove" on public.shared_accounts as restrictive for delete to authenticated using (((select auth.jwt()) ->> 'client_id') is null);
create policy "connected apps read only: remove" on public.household_invites as restrictive for delete to authenticated using (((select auth.jwt()) ->> 'client_id') is null);
create policy "second step: passed" on public.households as restrictive for all to authenticated
  using ((((select auth.jwt()) ->> 'client_id') is not null) or not (select public.second_step_pending()));
create policy "second step: passed" on public.household_members as restrictive for all to authenticated
  using ((((select auth.jwt()) ->> 'client_id') is not null) or not (select public.second_step_pending()));
create policy "second step: passed" on public.household_invites as restrictive for all to authenticated
  using ((((select auth.jwt()) ->> 'client_id') is not null) or not (select public.second_step_pending()));
create policy "second step: passed" on public.shared_accounts as restrictive for all to authenticated
  using ((((select auth.jwt()) ->> 'client_id') is not null) or not (select public.second_step_pending()))
  with check ((((select auth.jwt()) ->> 'client_id') is not null) or not (select public.second_step_pending()));

-- The checks every household function makes first: a person, not a connected
-- app, past the second step. Definer functions skip row-level security, so
-- they must hold these lines themselves.
create function public.household_caller() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'a connected app cannot do this' using errcode = '42501';
  end if;
  if public.second_step_pending() then
    raise exception 'finish two-step sign-in first' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;
revoke all on function public.household_caller() from public, anon, authenticated;

-- Invite someone: makes the household on the first invitation, and refuses
-- a fifth seat (people plus open invitations) or someone already in it. A new
-- link for the same email replaces the old one.
create function public.create_household_invite(p_email text, p_token_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.household_caller();
  who text := lower(trim(coalesce(p_email, '')));
  hh uuid;
  seats int;
  invite uuid;
begin
  if who = (select lower(u.email) from auth.users u where u.id = me) then
    raise exception 'invite someone else' using errcode = '22023';
  end if;
  hh := public.my_household();
  if hh is null then
    -- Private until shared: whoever starts a household starts it sharing nothing.
    delete from public.shared_accounts s where s.user_id = me;
    insert into public.households default values returning id into hh;
    insert into public.household_members (household_id, user_id) values (hh, me);
  elsif exists (select 1 from public.household_members m join auth.users u on u.id = m.user_id where m.household_id = hh and lower(u.email) = who) then
    raise exception 'already in your household' using errcode = '23505';
  end if;
  delete from public.household_invites i where i.household_id = hh and i.email = who;
  select (select count(*) from public.household_members m where m.household_id = hh)
       + (select count(*) from public.household_invites i where i.household_id = hh and i.expires_at > now())
    into seats;
  if seats >= 4 then
    raise exception 'a household has room for four people' using errcode = '23514';
  end if;
  insert into public.household_invites (household_id, invited_by, email, token_hash)
    values (hh, me, who, p_token_hash) returning id into invite;
  return invite;
end;
$$;
revoke all on function public.create_household_invite(text, text) from public, anon;
grant execute on function public.create_household_invite(text, text) to authenticated;

-- What the join page may say about an invitation. To anyone but the person it
-- was made for, it says only that: not who sent it, nor to whom.
create function public.household_invite_status(p_token_hash text) returns table (status text, invited_by_name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := public.household_caller();
  inv public.household_invites;
begin
  select * into inv from public.household_invites i where i.token_hash = p_token_hash;
  if not found then
    return query select 'not_found'::text, null::text;
  elsif inv.email <> (select lower(u.email) from auth.users u where u.id = me) then
    return query select 'wrong_email'::text, null::text;
  elsif inv.expires_at <= now() then
    return query select 'expired'::text, null::text;
  elsif public.my_household() is not distinct from inv.household_id then
    return query select 'already_member'::text, null::text;
  elsif public.my_household() is not null then
    return query select 'in_another'::text, null::text;
  elsif (select count(*) from public.household_members m where m.household_id = inv.household_id) >= 4 then
    return query select 'full'::text, null::text;
  else
    return query select 'ok'::text, (select p.first_name from public.profiles p where p.user_id = inv.invited_by);
  end if;
end;
$$;
revoke all on function public.household_invite_status(text) from public, anon;
grant execute on function public.household_invite_status(text) to authenticated;

-- Join: only the person the invitation names, only once, only while it's
-- open, only into a household with room, and only from no household at all.
create function public.accept_household_invite(p_token_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.household_caller();
  inv public.household_invites;
begin
  select * into inv from public.household_invites i where i.token_hash = p_token_hash for update;
  if not found then
    raise exception 'no such invitation' using errcode = 'P0002';
  end if;
  if inv.email <> (select lower(u.email) from auth.users u where u.id = me) then
    raise exception 'this invitation is for someone else' using errcode = '42501';
  end if;
  if inv.expires_at <= now() then
    raise exception 'this invitation has expired' using errcode = '22023';
  end if;
  if public.my_household() is not null then
    raise exception 'already in a household' using errcode = '23505';
  end if;
  if (select count(*) from public.household_members m where m.household_id = inv.household_id) >= 4 then
    raise exception 'a household has room for four people' using errcode = '23514';
  end if;
  -- Private until shared: whoever joins starts sharing nothing.
  delete from public.shared_accounts s where s.user_id = me;
  insert into public.household_members (household_id, user_id) values (inv.household_id, me);
  delete from public.household_invites i where i.id = inv.id;
  return inv.household_id;
end;
$$;
revoke all on function public.accept_household_invite(text) from public, anon;
grant execute on function public.accept_household_invite(text) to authenticated;

create function public.decline_household_invite(p_token_hash text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.household_caller();
begin
  delete from public.household_invites i
  where i.token_hash = p_token_hash and i.email = (select lower(u.email) from auth.users u where u.id = me);
end;
$$;
revoke all on function public.decline_household_invite(text) from public, anon;
grant execute on function public.decline_household_invite(text) to authenticated;

-- Leave: stop sharing and go, at once. The last one out takes the household
-- (and its open invitations) with them, through the trigger below.
create function public.leave_household() returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.household_caller();
begin
  delete from public.shared_accounts s where s.user_id = me;
  delete from public.household_members m where m.user_id = me;
end;
$$;
revoke all on function public.leave_household() from public, anon;
grant execute on function public.leave_household() to authenticated;

create function public.household_empty_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.households h
  where h.id = old.household_id and not exists (select 1 from public.household_members m where m.household_id = old.household_id);
  return null;
end;
$$;
revoke all on function public.household_empty_check() from public, anon, authenticated;
create trigger household_empty after delete on public.household_members for each row execute function public.household_empty_check();

-- Who is in the caller's household, for the Account page.
create function public.household_people() returns table (user_id uuid, first_name text, email text, joined_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := public.household_caller();
begin
  return query
    select m.user_id, p.first_name, u.email::text, m.joined_at, m.user_id = me
    from public.household_members m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.user_id = m.user_id
    where m.household_id = public.my_household()
    order by m.joined_at;
end;
$$;
revoke all on function public.household_people() from public, anon;
grant execute on function public.household_people() to authenticated;

-- The other members' shared money, as SEALED copies the app opens and then
-- narrows to exactly the accounts each owner shared. Never a token. A bank
-- connection with nothing shared isn't returned at all, not even its name;
-- nor are someone's hand-added items or category fixes unless they share
-- something those apply to.
create function public.household_shared_money() returns table (
  user_id uuid,
  first_name text,
  shared_account_ids text[],
  sealed_category_rules text,
  sealed_manual_items text,
  items jsonb
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
      case when exists (select 1 from public.shared_accounts s where s.user_id = m.user_id and s.item_id is null) then p.sealed_manual_items end,
      coalesce(
        (select jsonb_agg(jsonb_build_object('item_id', i.item_id, 'institution_name', i.institution_name, 'sealed_sync', i.sealed_sync, 'synced_at', i.synced_at) order by i.item_id)
         from public.plaid_items i
         where i.user_id = m.user_id and i.item_id in (select s.item_id from public.shared_accounts s where s.user_id = m.user_id and s.item_id is not null)),
        '[]'::jsonb
      )
    from public.household_members m
    left join public.profiles p on p.user_id = m.user_id
    where m.household_id = public.my_household()
      and m.user_id <> me
      and exists (select 1 from public.shared_accounts s where s.user_id = m.user_id);
end;
$$;
revoke all on function public.household_shared_money() from public, anon;
grant execute on function public.household_shared_money() to authenticated;
