-- Prism accounts: everything a signed-in person owns, and nothing else.
--
-- Every table is keyed on auth.users and locked with row-level security to
-- the person it belongs to. Bank and Coinbase tokens are stored SEALED
-- (AES-256-GCM with the app's PRISM_VAULT_KEY, which the database never
-- sees): a leaked row, backup or policy mistake yields ciphertext only.
-- Budgets and goals are the same versioned JSON the device plan uses, so one
-- set of all-or-nothing validators guards both; null means "never edited".

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  first_name text check (first_name is null or char_length(first_name) between 1 and 40),
  plan_budgets jsonb check (plan_budgets is null or (jsonb_typeof(plan_budgets) = 'array' and jsonb_array_length(plan_budgets) <= 9)),
  plan_goals jsonb check (plan_goals is null or (jsonb_typeof(plan_goals) = 'array' and jsonb_array_length(plan_goals) <= 8)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plaid_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null check (char_length(item_id) between 1 and 200),
  sealed_token text not null check (char_length(sealed_token) between 29 and 4000),
  institution_id text check (institution_id is null or char_length(institution_id) <= 100),
  institution_name text check (institution_name is null or char_length(institution_name) <= 200),
  linked_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table public.coinbase_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sealed_tokens text not null check (char_length(sealed_tokens) between 29 and 4000),
  expires_at timestamptz not null,
  -- Coinbase refresh tokens work once: a refresh only lands if the version it
  -- read is still current, so two tabs can never both spend the same token.
  version integer not null default 1,
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.calendar_feeds (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- sha256 of the secret in the feed URL; the URL itself is never stored in clear.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  sealed_token text not null check (char_length(sealed_token) between 29 and 1000),
  -- The bills and paydays to publish, refreshed as the person uses Prism.
  snapshot jsonb not null default '{}'::jsonb check (pg_column_size(snapshot) < 262144),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.plaid_items enable row level security;
alter table public.coinbase_links enable row level security;
alter table public.calendar_feeds enable row level security;

-- One owner-only policy per table and command. (select auth.uid()) is
-- evaluated once per statement, not once per row.
create policy "own profile: read" on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy "own profile: create" on public.profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own profile: update" on public.profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own banks: read" on public.plaid_items for select to authenticated using (user_id = (select auth.uid()));
create policy "own banks: add" on public.plaid_items for insert to authenticated with check (user_id = (select auth.uid()));
-- Re-linking the same bank replaces its sealed token (an upsert), so owners may update their own rows.
create policy "own banks: replace" on public.plaid_items for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own banks: remove" on public.plaid_items for delete to authenticated using (user_id = (select auth.uid()));

create policy "own coinbase: read" on public.coinbase_links for select to authenticated using (user_id = (select auth.uid()));
create policy "own coinbase: add" on public.coinbase_links for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own coinbase: update" on public.coinbase_links for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own coinbase: remove" on public.coinbase_links for delete to authenticated using (user_id = (select auth.uid()));

create policy "own calendar: read" on public.calendar_feeds for select to authenticated using (user_id = (select auth.uid()));
create policy "own calendar: create" on public.calendar_feeds for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own calendar: update" on public.calendar_feeds for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own calendar: remove" on public.calendar_feeds for delete to authenticated using (user_id = (select auth.uid()));

-- Nobody signed out touches these tables at all.
revoke all on public.profiles, public.plaid_items, public.coinbase_links, public.calendar_feeds from anon;

-- A profile for every new account, carrying the optional first name given at sign-up.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  given text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'first_name', '')), '');
begin
  insert into public.profiles (user_id, first_name)
  values (new.id, case when given is not null and char_length(given) <= 40 then given end)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- The one door a calendar app (which never signs in) may use: exchange the
-- sha256 of a feed URL's secret for that feed's snapshot — nothing else.
create function public.calendar_feed_snapshot(p_token_hash text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select f.snapshot from public.calendar_feeds f
  where p_token_hash ~ '^[0-9a-f]{64}$' and f.token_hash = p_token_hash
$$;
revoke all on function public.calendar_feed_snapshot(text) from public;
grant execute on function public.calendar_feed_snapshot(text) to anon, authenticated;

-- Keep updated_at honest without trusting the client's clock.
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger coinbase_links_touch before update on public.coinbase_links for each row execute function public.touch_updated_at();
create trigger calendar_feeds_touch before update on public.calendar_feeds for each row execute function public.touch_updated_at();

-- "Delete my account" means gone: the auth user and, by cascade, every row
-- above. The app first revokes each bank and Coinbase link at the source.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
