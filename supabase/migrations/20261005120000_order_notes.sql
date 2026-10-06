-- What an Amazon charge paid for (src/lib/finance/orders.ts): the items of
-- each order shipment, from the person's own Amazon order history, by the
-- bank transaction it matched. The file is read in their browser and never
-- uploaded; only the matches are kept, and the server checks each one adds
-- up to its bank charge to the cent.
--
-- Item names are sellers' words about the person's shopping, so they are
-- SEALED with PRISM_VAULT_KEY (gzip + AES-256-GCM, "z1." or "z2.<key id>.")
-- like the payment notes beside them: the database holds ciphertext only.
-- The column lives on the person's own profile row, so the profile's policies
-- already govern it: only its owner reads or writes it, a connected app can
-- read it and never write it, a session that hasn't passed two-step sign-in
-- gets nothing, and no household function names it.

alter table public.profiles
  add column sealed_order_notes text check (sealed_order_notes is null or char_length(sealed_order_notes) between 29 and 2000000);

comment on column public.profiles.sealed_order_notes is
  'What each Amazon charge paid for, by bank transaction, sealed with the app''s vault key. Ciphertext only; null when there are none.';
