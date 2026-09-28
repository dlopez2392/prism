-- The advisor's preferred shape for the connected-app checks: auth.jwt()
-- itself in a sub-select, so Postgres reads the token once per statement
-- (an initPlan), never once per row. Same rule, same result.

alter policy "connected apps read only: add" on public.profiles with check (((select auth.jwt()) ->> 'client_id') is null);
alter policy "connected apps read only: change" on public.profiles using (((select auth.jwt()) ->> 'client_id') is null) with check (((select auth.jwt()) ->> 'client_id') is null);
alter policy "connected apps read only: remove" on public.profiles using (((select auth.jwt()) ->> 'client_id') is null);
alter policy "connected apps read only: add" on public.plaid_items with check (((select auth.jwt()) ->> 'client_id') is null);
alter policy "connected apps read only: change" on public.plaid_items using (((select auth.jwt()) ->> 'client_id') is null) with check (((select auth.jwt()) ->> 'client_id') is null);
alter policy "connected apps read only: remove" on public.plaid_items using (((select auth.jwt()) ->> 'client_id') is null);
alter policy "connected apps read only: add" on public.coinbase_links with check (((select auth.jwt()) ->> 'client_id') is null);
alter policy "connected apps read only: change" on public.coinbase_links using (((select auth.jwt()) ->> 'client_id') is null) with check (((select auth.jwt()) ->> 'client_id') is null);
alter policy "connected apps read only: remove" on public.coinbase_links using (((select auth.jwt()) ->> 'client_id') is null);
alter policy "connected apps read only: add" on public.calendar_feeds with check (((select auth.jwt()) ->> 'client_id') is null);
alter policy "connected apps read only: change" on public.calendar_feeds using (((select auth.jwt()) ->> 'client_id') is null) with check (((select auth.jwt()) ->> 'client_id') is null);
alter policy "connected apps read only: remove" on public.calendar_feeds using (((select auth.jwt()) ->> 'client_id') is null);
