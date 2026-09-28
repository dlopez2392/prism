-- The rest of what a sign-in hangs on. A token issued to a connected app can
-- also ask Supabase Auth to move the account to another email address or
-- phone — and whoever controls the new one controls the account. Prism has
-- no change-email or phone feature, so, like the password, they are frozen:
-- the email a person signed up with is the only way in. (Supabase's "secure
-- email change" asks both inboxes too; this doesn't lean on a dashboard
-- toggle staying on.) A future change-email feature must replace this with a
-- flow that re-verifies the person first.

create or replace function public.refuse_password_changes() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(new.encrypted_password, '') <> '' and new.encrypted_password is distinct from old.encrypted_password then
    raise exception 'Prism accounts sign in with an email code; passwords cannot be set or changed' using errcode = '42501';
  end if;
  if new.email is distinct from old.email and old.email is not null then
    raise exception 'A Prism account''s email address cannot be changed' using errcode = '42501';
  end if;
  if coalesce(new.phone, '') <> '' and new.phone is distinct from old.phone then
    raise exception 'Prism accounts do not use a phone number' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.refuse_password_changes() from public, anon, authenticated;

drop trigger refuse_password_changes on auth.users;
create trigger refuse_sign_in_changes before update of encrypted_password, email, phone on auth.users
  for each row execute function public.refuse_password_changes();
