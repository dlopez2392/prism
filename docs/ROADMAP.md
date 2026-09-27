# Prism roadmap

Owner: Bespoke Intelligence Solutions. Last updated 2026-09-27.

## Committed integrations

The owner has approved these six integrations, and they are part of the plan.
Do not drop one, swap in a different provider, or start work that contradicts
one without the owner's sign-off. Each line gives the access path that
research found in September 2026 (`docs/research-2026-09-27.md`).

| # | Integration | Access path | Status |
|---|---|---|---|
| 1 | **Investment accounts through Plaid** | Plaid Investments, requested as an optional product in the same Link flow as banking. | Built: holdings map onto `Holding`, shown in the Net worth treemap |
| 2 | **Coinbase for crypto** | Coinbase sign-in (OAuth2) with the read-only `wallet:accounts:read` scope. Self-custody wallets later, read by public address. | Planned |
| 3 | **A credit-score partner such as Experian or SavvyMoney** | A bureau partner: Experian Connect or SavvyMoney. Brings permissible-purpose and FCRA compliance work. **Credit Karma has no way for other apps to read its data** — do not plan around it. | Planned (needs a partner agreement) |
| 4 | **A home-value service such as ATTOM** | ATTOM (or Estated) automated valuation. **Zillow closed its public data access in 2021**, and its successor, Bridge, serves MLS members only — do not plan around Zillow. | Planned (paid data provider) |
| 5 | **Bill reminders in your calendar** | A private, per-person calendar feed (ICS) that works in Google, Apple and Outlook calendars; the Google Calendar API only if a two-way sync is ever needed. | Planned |
| 6 | **A way for people to ask Claude or ChatGPT about their own money, read-only** | A read-only MCP server that exposes the person's own data and cites the transactions behind every answer. It never moves money and never writes data. | Planned |

## Product roadmap, in order

1. **Accounts and sign-in** — per-person storage for linked banks, budgets and
   goals; Plaid tokens move from the sealed cookie to an encrypted,
   server-side store.
2. **Plaid webhooks and a stored sync cursor** — each load fetches only what
   changed.
3. **Editable budgets and goals**, saved per person.
4. **Household views** ("yours, mine, ours").
5. **A fallback aggregator** (Finicity or MX) for when a bank's Plaid
   connection breaks.
6. **The committed integrations above**, with the MCP server (#6) as soon as
   accounts exist, since it needs to know whose money it is reading.
