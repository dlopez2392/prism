-- Connected apps (Claude, ChatGPT and other MCP clients) sign in through
-- Supabase's OAuth 2.1 server, and every token they hold carries a
-- `client_id` claim that a person's own session never does. Prism promises
-- those apps READ-ONLY access, so the database keeps the promise itself: a
-- restrictive policy on every write refuses any token with a client_id,
-- whatever the permissive owner policies allow and whatever the app's code
-- does. A leaked connector token can read what its owner could read — never
-- change a budget, unlink a bank, reset a calendar link or delete the account.

create policy "connected apps read only: add" on public.profiles as restrictive for insert to authenticated
  with check ((select auth.jwt() ->> 'client_id') is null);
create policy "connected apps read only: change" on public.profiles as restrictive for update to authenticated
  using ((select auth.jwt() ->> 'client_id') is null) with check ((select auth.jwt() ->> 'client_id') is null);
create policy "connected apps read only: remove" on public.profiles as restrictive for delete to authenticated
  using ((select auth.jwt() ->> 'client_id') is null);

create policy "connected apps read only: add" on public.plaid_items as restrictive for insert to authenticated
  with check ((select auth.jwt() ->> 'client_id') is null);
create policy "connected apps read only: change" on public.plaid_items as restrictive for update to authenticated
  using ((select auth.jwt() ->> 'client_id') is null) with check ((select auth.jwt() ->> 'client_id') is null);
create policy "connected apps read only: remove" on public.plaid_items as restrictive for delete to authenticated
  using ((select auth.jwt() ->> 'client_id') is null);

create policy "connected apps read only: add" on public.coinbase_links as restrictive for insert to authenticated
  with check ((select auth.jwt() ->> 'client_id') is null);
create policy "connected apps read only: change" on public.coinbase_links as restrictive for update to authenticated
  using ((select auth.jwt() ->> 'client_id') is null) with check ((select auth.jwt() ->> 'client_id') is null);
create policy "connected apps read only: remove" on public.coinbase_links as restrictive for delete to authenticated
  using ((select auth.jwt() ->> 'client_id') is null);

create policy "connected apps read only: add" on public.calendar_feeds as restrictive for insert to authenticated
  with check ((select auth.jwt() ->> 'client_id') is null);
create policy "connected apps read only: change" on public.calendar_feeds as restrictive for update to authenticated
  using ((select auth.jwt() ->> 'client_id') is null) with check ((select auth.jwt() ->> 'client_id') is null);
create policy "connected apps read only: remove" on public.calendar_feeds as restrictive for delete to authenticated
  using ((select auth.jwt() ->> 'client_id') is null);

-- Deleting the account is the person's alone, never a connected app's.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'a connected app cannot delete an account' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- The person's own time zone (IANA name), kept from their browser, so a
-- connected app asking about "this month" gets the month the person is in.
alter table public.profiles
  add column time_zone text check (time_zone is null or (char_length(time_zone) between 1 and 64 and time_zone ~ '^[A-Za-z][A-Za-z0-9_+/-]*$'));
