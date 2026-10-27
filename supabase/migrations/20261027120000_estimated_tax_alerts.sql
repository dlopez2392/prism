-- A fifth alert kind, estimated-tax: a week before each quarterly IRS due date,
-- for someone who pays estimated tax and whose payment Prism hasn't seen
-- (src/lib/finance/alerts.ts). The constraint widens; nobody's choices change,
-- and new accounts start with every kind chosen, as before.
--
-- Run in production by the owner from the SQL editor on 2026-10-27 (it drops
-- and re-adds a constraint, which the agent's tools leave to the owner); this
-- file is that statement, so every other database matches.

alter table public.profiles drop constraint profiles_alert_kinds_check;
alter table public.profiles add constraint profiles_alert_kinds_check
  check (alert_kinds <@ array['bank', 'bill-short', 'price-rise', 'weekly', 'estimated-tax']::text[]);

alter table public.profiles alter column alert_kinds
  set default array['bank', 'bill-short', 'price-rise', 'weekly', 'estimated-tax']::text[];

comment on column public.profiles.alert_kinds is 'Which alerts they want: bank, bill-short, price-rise, weekly, estimated-tax.';
