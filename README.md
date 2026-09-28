# Prism — personal finance, in full colour

**A Bespoke Intelligence Solutions (BIS) product.**

A standalone consumer budgeting and money app: link a bank, then see where
money came from, where it went, what's coming next, and how far you've come.
Every screen leads with a chart.

Prism is its own product. It shares no code, database, authentication or
deployment with any other BIS software.

- Design contract: [`DESIGN.md`](./DESIGN.md)
- Market and integration research: [`docs/research-2026-09-27.md`](./docs/research-2026-09-27.md)

## Run it

Requires Node 22 and pnpm 10.

```bash
pnpm install
pnpm dev            # http://localhost:3100
```

With no configuration it runs on a **demo household**: thirteen months of one
person's (fictional) money, generated deterministically, so every chart works
before anyone shares real data.

## Link a real bank (Plaid)

1. Create a free Plaid account and copy the **sandbox** keys.
2. `cp .env.example .env.local` and fill in `PLAID_CLIENT_ID` and `PLAID_SECRET`.
3. Restart `pnpm dev`, press **Connect a bank**, pick any test bank and sign in
   with `user_good` / `pass_good`.

For production set `PLAID_ENV=production` and a real `PRISM_VAULT_KEY`
(`openssl rand -base64 32`); the app refuses to store tokens without one.

## Link Coinbase (read-only)

1. On the Coinbase Developer Platform, create an OAuth client and register
   the redirect URI `https://<your-domain>/api/coinbase/callback`.
2. Set `COINBASE_CLIENT_ID`, `COINBASE_CLIENT_SECRET` and `PRISM_VAULT_KEY`.
3. **Connect Coinbase** appears on Connections. Prism asks only for
   `wallet:accounts:read` (plus `offline_access` to stay connected) and never
   for anything that can send, buy or sell.

Coinbase refresh tokens can be used once, so `src/proxy.ts` refreshes a link
shortly before its hour is up and stores the new pair in the same response.
It runs only for browsers holding a Coinbase link.

## Accounts (Supabase)

Signed out, Prism works as before: a demo household, plans and links kept on
the device. Signed in, banks, Coinbase, budgets, goals and a private calendar
link live in the person's account.

1. Create a Supabase project and apply `supabase/migrations/*.sql`.
2. Authentication → URL configuration: Site URL `https://<your-domain>`, and
   redirect URLs `https://<your-domain>/**` (plus `http://localhost:3100/**`).
3. Authentication → Emails → "Magic link": include the code, e.g.
   `Your Prism code is {{ .Token }}` beside the `{{ .ConfirmationURL }}` link.
4. Authentication → SMTP: a real sender (e.g. Resend). Supabase's built-in
   mailer only reaches the project's own team members.
5. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and
   `PRISM_VAULT_KEY`.

How it's kept safe:

- **Row-level security on every table**, proven in CI: the migration runs in an
  in-memory Postgres (PGlite) and `src/lib/supabase/schema.test.ts` checks each
  rule as a signed-in stranger and as nobody.
- **No privileged key anywhere.** The server acts as the signed-in person; the
  only thing a signed-out caller can run is the calendar lookup, and only with
  the feed's secret.
- **Tokens are sealed before they're stored** with `PRISM_VAULT_KEY`, which the
  database never sees.
- **Moving device data into an account asks first**, so signing in on a shared
  computer can't sweep someone else's bank into your account.
- **Delete account** revokes every bank at Plaid and Coinbase at Coinbase, then
  deletes the person and every row of theirs.

## Ask AI about your money (MCP)

Prism is an MCP server at **`/mcp`** (production:
`https://prism.bis-rgv.com/mcp`). Add it to Claude (Customize → Connectors →
Add custom connector) or ChatGPT (Developer mode → custom connector); the app
sends the person to Prism to sign in and approve it, and from then on can ask
nine read-only questions: `get_overview`, `list_accounts`,
`search_transactions`, `spending_breakdown`, `get_cash_flow`, `get_budgets`,
`get_goals`, `upcoming_bills`, `get_net_worth`. Answers cite the transactions
they rest on, carry the person's own "today" and time zone, and say
`demo: true` when nothing is linked yet.

Sign-in is **Supabase Auth's OAuth 2.1 server**, so nothing new holds a
secret. To switch it on (once per project): Authentication → OAuth Server →
enable, authorization path `/oauth/consent`, and allow dynamic client
registration. `/.well-known/oauth-protected-resource/mcp` points MCP clients
at it.

Why it's safe to connect:

- **Read-only is enforced by the database**, not just the tool list: a
  restrictive policy on every table refuses any write from a token carrying a
  `client_id` (the claim every connected-app token has and a person's own
  session never does), and `delete_my_account` refuses them too. Proven in
  `schema.test.ts` and against the live project.
- **Only connected-app tokens are accepted** at `/mcp`, and Supabase Auth is
  asked about every one — so an app disconnected on the Account page is cut
  off immediately, not when its token expires.
- **The consent screen leads with what can be checked**: the site the person
  will be sent back to, and in plain words what the app can and can't do.
- **Nothing refreshes on an app's behalf.** A lapsed Coinbase token waits for
  the person's next visit (its refresh token works once and a connected app
  can't save the new one), and the answer says so.
- The tools are pure functions over the same analysis every screen draws from
  (`src/lib/agent/tools.ts`), so a chat can't disagree with the app.

## Deploy

Production: **https://prism.bis-rgv.com** (Vercel, auto-deploys every push to
`main`). `vercel.json` makes each deploy run lint and the unit tests before the
build, so a failing test blocks a release even if CI is skipped. With no Plaid
keys the deployment serves the demo household.

Any Next.js host works. On Vercel: import the repository, keep the detected
Next.js settings, and add the environment variables from `.env.example`.

## Screens

| Screen | What it shows |
|---|---|
| **Overview** | Net worth hero, safe-to-spend, four headline numbers, spending pace vs last month, category donut, budget rings, evidence-backed insights, upcoming bills, recent activity |
| **Cash flow** | Income → categories → saved **Sankey**, money in vs out by month, what you kept each month, savings-rate trend |
| **Spending** | Stacked monthly bars by category, category change vs the prior period, top merchants, a year-long **calendar heatmap**, searchable ledger |
| **Budgets** | Month plan left, bullet chart (spent · projected · limit), a ring per budget with a "today" tick, and an editor that sets each limit beside what that category usually costs |
| **Future** | 60-day checking **balance forecast** with an 80% band, paydays and bills marked, safe-to-spend, subscriptions with price-rise flags, and **Add to calendar** for bill reminders |
| **Goals** | A ring per goal, progress-as-share-of-target chart with projections, a **what-if** slider that can save its amount, and add / edit / delete |
| **Net worth** | Own vs owe over 12 months, every account with its trend, holdings **treemap**, credit-score gauge and factors |
| **Connections** | Per-institution health, how data is protected, and an honest catalogue of every integration and its real access path |

## How it's built

Next.js 16 (App Router), React 19, Tailwind 4, TypeScript, Vitest.

```
src/lib/brand.ts   product and company names — one place to rename
src/lib/finance/   provider-neutral model + pure analytics (cash flow, budget
                   pacing, recurring detection, forecast, Sankey, insights)
src/lib/charts/    chart geometry (scales, curves, bars, arcs, treemap)
src/lib/plaid/     dependency-free Plaid client + mapping onto the model
src/lib/coinbase/  dependency-free Coinbase client (OAuth2 + PKCE) + mapping
src/proxy.ts       keeps a Coinbase link alive (single-use refresh tokens)
src/lib/server/    data loading (account vs device, demo vs live), the sealed
                   token vault, plans, sign-in and account actions
src/lib/supabase/  per-request Supabase client (acts as the person, never admin)
src/lib/agent/     the MCP server: pure read-only tools over the analysis, and
                   their registration with @modelcontextprotocol/server
supabase/          the account schema, with row-level security
src/components/    chart kit (SVG, no chart library) and UI blocks
src/app/           the eight screens + /api/plaid/{link-token,exchange,disconnect}
                   + /api/coinbase/{connect,callback,disconnect}
                   + /calendar/{bills,demo}.ics, /calendar/feed/<secret>.ics
                   + /sign-in, /auth/callback, /account
                   + /mcp, /oauth/consent, /.well-known/oauth-protected-resource
```

- **Money is integer cents** end to end; dates are calendar dates, never instants.
- **Charts are hand-built SVG** so every mark follows the design contract: 4px
  rounded data-ends, 2px gaps, crosshair tooltips, keyboard focus, and a
  "Table" twin for every chart.
- **The palette is validated**, not picked: eight categorical hues in an order
  that stays distinguishable for colour-blind readers in both themes
  (worst adjacent CVD ΔE 10.1), every text colour measured at WCAG AA.
- **Insights show their work:** each one carries the exact transactions it was
  computed from.
- **Budget projections use history, not straight lines**, so rent on the 1st
  never makes Housing look thirty times over budget.
- **Your plan, on your device:** edited budgets and goals are saved in two
  httpOnly cookies and applied before any chart is drawn, so an edit moves
  every screen at once. Whatever comes back from a cookie is re-validated,
  all or nothing.
- **Calendar reminders are real iCalendar:** one repeating series per bill
  (so "delete all future events" works when a subscription ends), all-day
  dates that land on the right day in any zone, month-end bills that clamp to
  the last day of short months, and stable UIDs so a fresh download updates
  rather than duplicates. `/calendar/bills.ics` is the person's own file;
  `/calendar/demo.ics` is a public, subscribable feed of the demo household.

## Gates

```bash
pnpm typecheck
pnpm lint
pnpm test          # vitest — analytics, geometry, Plaid + Coinbase, vault, plans, calendar
pnpm build
```

CI (`.github/workflows/ci.yml`) runs all four on every push.

## License

Proprietary. © 2026 Bespoke Intelligence Solutions. All rights reserved. The
source is public for reference only; see [`LICENSE`](./LICENSE).

## Prototype limits (deliberate) and next steps

- **Storage:** linked-bank tokens live in an AES-256-GCM sealed, httpOnly
  cookie so the prototype needs no database. Production moves them to a
  per-user, KMS-encrypted server-side store with sign-in, and persists the
  `/transactions/sync` cursor so each load fetches only what changed.
- **Signed out**, budgets, goals and links stay on the device (sealed
  cookies); signing in offers to move them into the account.
- **Calendar reminders**: anyone can download them; a signed-in person gets a
  private, self-updating link (a revocable secret whose sha256 is all the
  database stores).
- **What's next:** see [`docs/ROADMAP.md`](./docs/ROADMAP.md) — the product
  roadmap in order, and the six owner-approved integrations (Plaid
  investments, Coinbase, a credit-score partner, a home-value service,
  calendar bill reminders, and read-only AI access to your own money).
