-- What a person tells Prism about their subscriptions (src/lib/finance/
-- subscriptions.ts) rides in the record that already keeps what they add to
-- their transactions: which repeating charges are or aren't a subscription,
-- the ones they cancelled and the day they did, and the ones they add by hand.
-- It names shops, so it's sealed like the rest, never shown to a household,
-- and needs no column of its own: only the column's description changes.

comment on column public.profiles.sealed_txn_details is
  'Splits, tags and who owes the person, by bank transaction; the accounts and lines they leave out of their totals; and what they said about their subscriptions (marks by shop, ones cancelled and when, ones added by hand). Sealed with the app''s vault key. Ciphertext only; null when there are none.';
