-- Self-custody crypto wallets, added by public address (src/lib/crypto/).
--
-- An address is private: anyone who ties it to a person sees everything it
-- has ever held. So the addresses, with each wallet's last reading, are SEALED
-- with PRISM_VAULT_KEY on the person's own profile, in a column of their own
-- that household_shared_money never sends: a wallet is never shared with a
-- household. The profile's policies govern the column: only its owner reads or
-- writes it, a connected app can read it and never write it, and a session
-- that hasn't passed two-step sign-in gets nothing.

alter table public.profiles
  add column sealed_wallets text check (sealed_wallets is null or char_length(sealed_wallets) between 29 and 40000);

comment on column public.profiles.sealed_wallets is
  'Crypto wallets the person added by public address, and what each last held; sealed with the app''s vault key. Ciphertext only; null when there are none. Never shared with a household.';
