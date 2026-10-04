-- Who a Venmo, PayPal or Cash App payment was for (src/lib/finance/p2p.ts):
-- the name and note of each payment, from the person's own file of that app,
-- by the bank transaction it matched. The file is read in their browser and
-- never uploaded; only the matches are kept.
--
-- Names and notes are other people's words about the person's money, so
-- they are SEALED with PRISM_VAULT_KEY (gzip + AES-256-GCM, "z1." or
-- "z2.<key id>.") like the category fixes beside them: the database holds
-- ciphertext only. The column lives on the person's own profile row, so the
-- profile's policies already govern it: only its owner reads or writes it, a
-- connected app can read it and never write it, a session that hasn't passed
-- two-step sign-in gets nothing, and no household function names it.

alter table public.profiles
  add column sealed_p2p_notes text check (sealed_p2p_notes is null or char_length(sealed_p2p_notes) between 29 and 1000000);

comment on column public.profiles.sealed_p2p_notes is
  'Who each Venmo, PayPal or Cash App payment was for, by bank transaction, sealed with the app''s vault key. Ciphertext only; null when there are none.';
