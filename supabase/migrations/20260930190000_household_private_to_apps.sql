-- Connected apps (Claude, ChatGPT through /mcp) answer questions about the
-- person's own money. Who is in their household, whom they've invited and
-- what they share with it are none of a connected app's business — yet a
-- connected-app token could still read these three tables directly (never
-- money, never a token, but member ids, invited email addresses and a share
-- list). It now reads nothing of them, like the household's own row
-- ("household: not for connected apps", 20260930120000). Prism's own AI
-- connector never asked for them, and every household function already
-- refused connected apps.
create policy "household: not for connected apps" on public.household_members as restrictive for select to authenticated
  using (((select auth.jwt()) ->> 'client_id') is null);
create policy "household: not for connected apps" on public.household_invites as restrictive for select to authenticated
  using (((select auth.jwt()) ->> 'client_id') is null);
create policy "household: not for connected apps" on public.shared_accounts as restrictive for select to authenticated
  using (((select auth.jwt()) ->> 'client_id') is null);

-- An invitation that has run out can't be used, and the app doesn't show it,
-- so nobody could cancel it and the address it was sent to stayed. Now a
-- household's expired invitations go whenever anyone in it sends a new one
-- (and the app removes them when it next shows the household), and the ones
-- already expired go now.
create function public.household_invites_tidy() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.household_invites i where i.household_id = new.household_id and i.expires_at <= now();
  return new;
end;
$$;
revoke all on function public.household_invites_tidy() from public, anon, authenticated;
create trigger household_invites_tidy before insert on public.household_invites
  for each row execute function public.household_invites_tidy();

delete from public.household_invites where expires_at <= now();
