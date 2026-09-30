-- History a person imports from a CSV file (Mint, Monarch, any spreadsheet).
--
-- The file never leaves their browser; the rows it maps arrive in batches,
-- each checked by the server and stored here SEALED (ciphertext only, opened
-- only by the app with PRISM_VAULT_KEY), one row per batch ("part"). Part 0
-- also holds what the import is (its name, and the linked account it's older
-- history of, if any) and how many parts it has, and is written LAST: an
-- import without its part 0, or with fewer parts than it says, is unfinished
-- and never shown.
--
-- Like everything of theirs: only the person reads or changes it, a connected
-- app may read it and never change it, it waits behind their second step, and
-- deleting their account deletes it. It is never shared with a household.

create table public.imported_history (
  user_id uuid not null references auth.users (id) on delete cascade,
  import_id uuid not null,
  part smallint not null check (part between 0 and 59),
  sealed text not null check (char_length(sealed) between 29 and 4000000),
  created_at timestamptz not null default now(),
  primary key (user_id, import_id, part)
);

alter table public.imported_history enable row level security;
revoke all on public.imported_history from anon;

create policy "own imports: read" on public.imported_history for select to authenticated using (user_id = (select auth.uid()));
create policy "own imports: add" on public.imported_history for insert to authenticated with check (user_id = (select auth.uid()));
-- Changed only to reseal under a new vault key (account-store.ts, staleSeals).
create policy "own imports: reseal" on public.imported_history for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own imports: remove" on public.imported_history for delete to authenticated using (user_id = (select auth.uid()));

create policy "connected apps read only: add" on public.imported_history as restrictive for insert to authenticated
  with check (((select auth.jwt()) ->> 'client_id') is null);
create policy "connected apps read only: change" on public.imported_history as restrictive for update to authenticated
  using (((select auth.jwt()) ->> 'client_id') is null) with check (((select auth.jwt()) ->> 'client_id') is null);
create policy "connected apps read only: remove" on public.imported_history as restrictive for delete to authenticated
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "second step: passed" on public.imported_history as restrictive for all to authenticated
  using ((((select auth.jwt()) ->> 'client_id') is not null) or not (select public.second_step_pending()))
  with check ((((select auth.jwt()) ->> 'client_id') is not null) or not (select public.second_step_pending()));

-- At most 20 imports a person, so nobody can fill the database with them.
create function public.imported_history_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.imported_history h where h.user_id = new.user_id and h.import_id = new.import_id)
     and (select count(distinct h.import_id) from public.imported_history h where h.user_id = new.user_id) >= 20 then
    raise exception 'twenty imports is the most Prism keeps; remove one first' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.imported_history_limit() from public, anon, authenticated;
create trigger imported_history_limit before insert on public.imported_history
  for each row execute function public.imported_history_limit();
