-- Prism signs people in with a one-time email code and nothing else. Supabase
-- gives every code-created account a random password nobody knows — and,
-- until now, would let ANY valid token for the account replace it: including
-- a token issued to a connected app (checked live: PUT /auth/v1/user with a
-- connector token set a password, answered 200). With a password it chose,
-- a leaked connector token could turn itself into a full sign-in, and every
-- read-only promise made to connected apps would be void.
--
-- So an account's password can never change, by anyone: Prism has no
-- password feature to break, the random one stays unknowable, and the only
-- way in stays the code sent to the person's own inbox.

create function public.refuse_password_changes() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(new.encrypted_password, '') <> '' and new.encrypted_password is distinct from old.encrypted_password then
    raise exception 'Prism accounts sign in with an email code; passwords cannot be set or changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.refuse_password_changes() from public, anon, authenticated;

create trigger refuse_password_changes before update of encrypted_password on auth.users
  for each row execute function public.refuse_password_changes();
