# Prism roadmap

Owner: Bespoke Intelligence Solutions. Last updated 2026-09-28 (accounts live on Supabase project `prism`, sign-in email through Resend, name asked after sign-in; MCP server built; bank sync keeps its place (roadmap item 2), live on Plaid's sandbox, with bank redirects for OAuth banks; Coinbase built; calendar reminders and on-device budgets and goals shipped 2026-09-27).

## Committed integrations

The owner has approved these six integrations, and they are part of the plan.
Do not drop one, swap in a different provider, or start work that contradicts
one without the owner's sign-off. Each line gives the access path that
research found in September 2026 (`docs/research-2026-09-27.md`).

| # | Integration | Access path | Status |
|---|---|---|---|
| 1 | **Investment accounts through Plaid** | Plaid Investments, requested as an optional product in the same Link flow as banking. | Built: holdings map onto `Holding`, shown in the Net worth treemap |
| 2 | **Coinbase for crypto** | Coinbase sign-in (OAuth2) with the read-only `wallet:accounts:read` scope. Self-custody wallets later, read by public address. | **Built (2026-09-28):** OAuth2 with PKCE and state, `wallet:accounts:read,offline_access` only; tokens sealed in an httpOnly cookie like the Plaid vault; `src/proxy.ts` refreshes them before they lapse, because Coinbase refresh tokens work once; every wallet priced in dollars from Coinbase's public rates and shown as one crypto account with a holding per coin. **Goes live when the owner** creates an OAuth client on the Coinbase Developer Platform and sets `COINBASE_CLIENT_ID` / `COINBASE_CLIENT_SECRET` in Vercel. Self-custody wallets are still to do. |
| 3 | **A credit-score partner such as Experian or SavvyMoney** | A bureau partner: Experian Connect or SavvyMoney. Brings permissible-purpose and FCRA compliance work. **Credit Karma has no way for other apps to read its data** — do not plan around it. | Planned (needs a partner agreement) |
| 4 | **A home-value service such as ATTOM** | ATTOM (or Estated) automated valuation. **Zillow closed its public data access in 2021**, and its successor, Bridge, serves MLS members only — do not plan around Zillow. | **Hand-entered values built (2026-09-29):** a signed-in person adds their home (or a vehicle, anything else they own, or money they owe) on Net worth and updates its value when it changes; each update is that month's value, so the trend is real. The provider stays planned (paid): when signed, it fills a home's monthly value into the same item. |
| 5 | **Bill reminders in your calendar** | A private, per-person calendar feed (ICS) that works in Google, Apple and Outlook calendars; the Google Calendar API only if a two-way sync is ever needed. | **Stage 1 built:** "Add to calendar" on Future downloads the person's bills and paydays as an iCalendar file (one repeating series per bill, an alert they choose, amounts optionally kept off the lock screen), and the demo household has a real subscribable feed at `/calendar/demo.ics`. **Stage 2 built with accounts (2026-09-28):** a signed-in person gets a private link (`/calendar/feed/<secret>.ics`) their calendar app follows; the database keeps only the secret's sha256 and a snapshot of bills and paydays, refreshed as they use Prism; "Reset link" kills a leaked URL at once. |
| 6 | **A way for people to ask Claude or ChatGPT about their own money, read-only** | A read-only MCP server that exposes the person's own data and cites the transactions behind every answer. It never moves money and never writes data. | **Built (2026-09-28):** `/mcp` (MCP SDK v2: the 2026-07-28 protocol plus stateless 2025 serving), nine read-only tools that cite transaction ids; sign-in through Supabase Auth's OAuth 2.1 server with a Prism consent screen and dynamic client registration; the database refuses every write from a connected-app token; Account page lists connected apps with Disconnect (immediate). **Live (2026-09-28):** the owner switched on the OAuth server (path `/oauth/consent`, dynamic registration on) and the whole journey was verified end to end against production's project — register, consent, token, questions, write refused, password/email/phone change refused, Disconnect immediate. Not yet: OpenAI's `search`/`fetch` pair for ChatGPT deep research. |

## Product roadmap, in order

1. **Accounts and sign-in** — per-person storage for linked banks, budgets and
   goals; Plaid tokens move from the sealed cookie to an encrypted,
   server-side store. **Live (2026-09-28)** on Supabase project `prism`
   (ref `mstdtbckfdrtinaoslda`, US East, ~$10/month — owner's decision): email
   one-time-code sign-in, row-level security on every table (tested in CI and
   applied live), sealed tokens, device data moved in only when the person
   agrees, and delete-account that revokes every link first. Verified end to
   end against the live project with a throwaway user (deleted by the app's
   own Delete account). `PRISM_VAULT_KEY` set in Vercel (sensitive) on
   2026-09-28 — replace freely until customers link banks, never after.
   Owner setup done the same day: Auth URL configuration, the code in the
   email template, and sign-in email sent from `no-reply@bis-rgv.com` through
   Resend (verified delivered). The sign-in form asks for the email ONLY; the
   first name is asked after sign-in (a welcome step on an account's first
   visit, and the Account page) and must read as a name — an optional field
   beside the email box collected a password by mistake, which was erased.
   **Two-step sign-in (2026-09-28):** optional authenticator-app codes after
   the email code, enforced by row-level security against Supabase's own
   session record; set up and turned off from the Account page.
2. **Plaid webhooks and a stored sync cursor** — each load fetches only what
   changed. **Built (2026-09-28):** each bank's cursor, synced
   transactions and balances are stored sealed (gzip + AES-256-GCM, ciphertext only) with a
   version guard; a fresh copy is served with no Plaid call, a stale or
   flagged one fetches only what changed; Plaid's signed webhook
   (`/api/plaid/webhook`, ES256 verified) flags the bank through an anon
   function that can touch nothing else; connected apps catch up in memory
   and never save. Verified end to end against the live project with a strict
   fake Plaid (first read, a reload with zero Plaid calls, tampered webhook refused,
   signed webhook flags, cursor pickup, last copy shown through a Plaid
   outage, Claude catch-up saves nothing). **Live on Plaid's sandbox
   (2026-09-28):** the owner's sandbox keys are set in Vercel; a test bank
   linked on a demo account was stored sealed, Plaid's own signed webhooks
   were verified in production, and the next visit fetched only what changed.
   **Bank redirects (OAuth banks) built the same day:** `/connections/return`
   resumes Link with the same token after a bank's own sign-in, for phones and
   in-app browsers that block pop-ups; switched on by allow-listing that
   address with Plaid and setting `PLAID_REDIRECT_URI`. Real banks wait on
   Plaid's production approval and its OAuth-institution registration.
   Known limits: one connection in flight per browser (a second tab's attempt
   replaces the first), and a bank app that returns people to a DIFFERENT
   browser finds nothing to resume and asks them to start again. Plaid's
   answer is to keep the Link token server-side by person, which suits
   signed-in accounts later.
3. **Editable budgets and goals**, saved per person. **Built on the device
   (2026-09-27):** people set every budget line, add, edit and delete goals,
   and save a what-if amount; the plan lives in two validated cookies on this
   browser (`prism-budgets`, `prism-goals`). Once accounts exist, import that
   plan into the account on first sign-in, then retire the cookies.
4. **Household views** ("yours, mine, ours"). **Shared accounts built
   (2026-09-29):** up to four adults, each with their own login, join by an
   invitation link; each shares account by account (private until shared);
   a Me / Household switch shows everyone's shared balances and
   transactions, labelled by whose they are. Data is shared, never access:
   members see each other's last stored copy, never a bank token.
   **Household budgets and goals built (2026-09-30):** one plan per
   household that every member can change (each list shows who changed it
   last, and a save from an outdated list is refused rather than lost);
   budgets pace spending from shared accounts only and are drafted from it
   until someone sets them. **Next:** link a goal to a shared savings account
   so its progress fills itself; sharing Coinbase.
5. **A fallback aggregator** (Finicity or MX) for when a bank's Plaid
   connection breaks.
6. **The committed integrations above**, with the MCP server (#6) as soon as
   accounts exist, since it needs to know whose money it is reading.
