-- A person's own fixes to the categories their bank gives transactions
-- (src/lib/finance/category-rules.ts): "everything at this shop is Food &
-- dining", or "just this one is a transfer".
--
-- Merchant names are bank-derived, so the fixes are SEALED with
-- PRISM_VAULT_KEY (gzip + AES-256-GCM, "z1." or "z2.<key id>.") like the
-- synced transactions themselves: the database holds ciphertext only. The
-- column lives on the person's own profile row, so the profile's policies
-- already govern it: only its owner reads or writes it, a connected app can
-- read it and never write it, and a session that hasn't passed two-step
-- sign-in gets nothing.

alter table public.profiles
  add column sealed_category_rules text check (sealed_category_rules is null or char_length(sealed_category_rules) between 29 and 400000);

comment on column public.profiles.sealed_category_rules is
  'The person''s category fixes, sealed with the app''s vault key. Ciphertext only; null when there are none.';
