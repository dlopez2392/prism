-- Two-step sign-in (an authenticator app, TOTP), enforced by the database.
--
-- Supabase Auth keeps each person's authenticator in auth.mfa_factors, and
-- marks every session in auth.sessions with the assurance level it reached
-- (aal1 after the email code, aal2 after an authenticator code) and the factor
-- it used to get there. Prism records WHICH factor is the person's own in
-- profiles.totp_factor_id. Only a session that has just passed that factor can
-- set it (the trigger below). From then on, until a session reaches aal2 with
-- that factor, the person's rows are closed to it. Someone who has only the
-- email inbox sees nothing, changes nothing and can't delete the account.
--
-- Why a registry and not "any verified factor": before a person turns this
-- on, any token for their account, a leaked connected-app token included, can
-- enroll a factor. Gating on that factor would lock the person out. Once a
-- factor is verified, Supabase refuses to add or remove factors below aal2
-- (checked live, 2026-09-28), so after set-up only a session that passed the
-- registered factor can change it.
--
-- Connected apps are exempt from the gate. Their tokens are read-only (see
-- connected_apps_read_only), and they were approved on Prism's consent screen,
-- which itself sits behind the second step.

alter table public.profiles add column totp_factor_id uuid;

-- True while the caller has a registered, still-verified authenticator that
-- this session hasn't passed. Both the token and Supabase's own session record
-- must say aal2, and the session must have used THAT factor.
create function public.second_step_pending() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.profiles p
    join auth.mfa_factors f on f.id = p.totp_factor_id and f.user_id = p.user_id and f.status = 'verified'
    where p.user_id = auth.uid()
      and not (
        coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
        and exists (
          select 1 from auth.sessions s
          where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
            and s.user_id = p.user_id
            and s.aal = 'aal2'
            and s.factor_id = p.totp_factor_id
        )
      )
  );
$$;
revoke all on function public.second_step_pending() from public, anon;
grant execute on function public.second_step_pending() to authenticated;

-- The caller's own registered authenticator, which the sign-in page asks a code
-- for. It's readable here even while the second step is pending, when the
-- profile itself isn't.
create function public.my_second_step_factor() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.totp_factor_id
  from public.profiles p
  join auth.mfa_factors f on f.id = p.totp_factor_id and f.user_id = p.user_id and f.status = 'verified'
  where p.user_id = auth.uid();
$$;
revoke all on function public.my_second_step_factor() from public, anon;
grant execute on function public.my_second_step_factor() to authenticated;

-- Registering an authenticator takes proof: this very session must have just
-- reached aal2 with it, and it must be the person's own verified TOTP factor.
-- Clearing it is left to row-level security, which already demands the second
-- step from anyone who has one.
create function public.check_totp_registration() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.totp_factor_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.totp_factor_id is not distinct from old.totp_factor_id then
    return new;
  end if;
  if not exists (
    select 1
    from auth.sessions s
    join auth.mfa_factors f on f.id = s.factor_id
    where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and s.user_id = new.user_id
      and s.aal = 'aal2'
      and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      and f.id = new.totp_factor_id
      and f.user_id = new.user_id
      and f.status = 'verified'
      and f.factor_type = 'totp'
  ) then
    raise exception 'register only the authenticator this session just used' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.check_totp_registration() from public, anon, authenticated;
create trigger check_totp_registration
  before insert or update of totp_factor_id on public.profiles
  for each row execute function public.check_totp_registration();

-- The gate, on every table that holds a person's money or plan.
create policy "second step: passed" on public.profiles as restrictive for all to authenticated
  using ((((select auth.jwt()) ->> 'client_id') is not null) or not (select public.second_step_pending()))
  with check ((((select auth.jwt()) ->> 'client_id') is not null) or not (select public.second_step_pending()));
create policy "second step: passed" on public.plaid_items as restrictive for all to authenticated
  using ((((select auth.jwt()) ->> 'client_id') is not null) or not (select public.second_step_pending()))
  with check ((((select auth.jwt()) ->> 'client_id') is not null) or not (select public.second_step_pending()));
create policy "second step: passed" on public.coinbase_links as restrictive for all to authenticated
  using ((((select auth.jwt()) ->> 'client_id') is not null) or not (select public.second_step_pending()))
  with check ((((select auth.jwt()) ->> 'client_id') is not null) or not (select public.second_step_pending()));
create policy "second step: passed" on public.calendar_feeds as restrictive for all to authenticated
  using ((((select auth.jwt()) ->> 'client_id') is not null) or not (select public.second_step_pending()))
  with check ((((select auth.jwt()) ->> 'client_id') is not null) or not (select public.second_step_pending()));

-- Deleting the account takes the second step too.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'a connected app cannot delete an account' using errcode = '42501';
  end if;
  if public.second_step_pending() then
    raise exception 'finish two-step sign-in first' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
