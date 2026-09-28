-- The first name is asked for AFTER sign-in, on the Account page, where the
-- app checks it reads as a name. Sign-up no longer carries one: an optional
-- field beside the email box is where people type passwords by mistake, and
-- whatever arrived in sign-up metadata was copied here unchecked. A new
-- account now starts with an empty profile, and nothing in the auth
-- metadata ever becomes the name Prism shows.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
