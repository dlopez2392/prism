-- What a person owns or owes that no bank reports — their home, a car, a
-- loan from family — added by hand (src/lib/finance/manual.ts), so their net
-- worth is the whole picture.
--
-- Values and names of what someone owns are financial data, so they are
-- SEALED with PRISM_VAULT_KEY (gzip + AES-256-GCM) like everything else Prism
-- keeps about money: the database holds ciphertext only. The column lives on
-- the person's own profile row, so the profile's policies already govern it:
-- only its owner reads or writes it, a connected app can read it and never
-- write it, and a session that hasn't passed two-step sign-in gets nothing.

alter table public.profiles
  add column sealed_manual_items text check (sealed_manual_items is null or char_length(sealed_manual_items) between 29 and 200000);

comment on column public.profiles.sealed_manual_items is
  'Things the person owns or owes, added by hand, sealed with the app''s vault key. Ciphertext only; null when there are none.';
