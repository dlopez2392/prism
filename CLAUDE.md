# Prism

@DESIGN.md

- Prism is a standalone consumer finance app, a product of Bespoke
  Intelligence Solutions (BIS). It is not part of any other BIS software and
  shares no code, database, authentication or deployment with it.
- Product and company names live in `src/lib/brand.ts`; never hard-code them.
- Gates before any merge: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm build`. CI runs all four (`.github/workflows/ci.yml`).
- Bank data: Plaid through `src/lib/plaid/*`, mapped onto
  `src/lib/finance/types.ts`. Without `PLAID_CLIENT_ID`/`PLAID_SECRET` the app
  runs on the deterministic demo household in `src/lib/finance/demo.ts`.
  Linking ANYTHING real (a bank or Coinbase) ends the demo: real and made-up
  money are never shown together.
- **Committed integrations (owner-approved, do not drop or substitute without
  the owner's sign-off)** — full notes in `docs/ROADMAP.md`:
  1. Investment accounts through Plaid (already built in).
  2. Coinbase for crypto (read-only OAuth). Built: `src/lib/coinbase/*`,
     `/api/coinbase/*`, token refresh in `src/proxy.ts` (refresh tokens are
     single-use: never refresh anywhere the new pair can't be stored).
  3. A credit-score partner such as Experian or SavvyMoney. Credit Karma has
     no way for other apps to read its data.
  4. A home-value service such as ATTOM, since Zillow closed its public data
     access in 2021.
  5. Bill reminders in your calendar (private ICS feed per person). Stage 1
     shipped: file download + public demo feed (`src/lib/finance/calendar.ts`).
  6. A way for people to ask Claude or ChatGPT about their own money,
     read-only (MCP server that cites its transactions).
- Product roadmap order: accounts and sign-in → Plaid webhooks + stored cursor
  → editable budgets and goals → household views → fallback aggregator → the
  integrations above. Keep `docs/ROADMAP.md` current as items ship. Accounts:
  the owner approved Supabase (its OWN project "prism", ref
  mstdtbckfdrtinaoslda, US East) on 2026-09-28; live since that day. Never
  point Prism at bis-platform-dev or any other product's project. Every new
  migration: add it under supabase/migrations, keep schema.test.ts green, then
  apply it to prism and re-run the advisors.
- Accounts architecture: `src/lib/supabase/*` makes a per-request client that
  acts AS the signed-in person — there is no service-role key in this app and
  there must never be one. Row-level security guards every table; every token
  is sealed with PRISM_VAULT_KEY before it's stored. Schema changes go in
  `supabase/migrations/` and must keep `src/lib/supabase/schema.test.ts`
  (PGlite) green. `getFinance()` reads the account when signed in, the device
  otherwise; actions read through the UNCACHED `readSources()`.
- The sign-in form asks for the email and NOTHING else — an optional field
  beside it is where people type passwords (it happened). Anything more about
  the person is asked after sign-in and validated for what it is: the first
  name goes through `readFirstName` in `src/lib/profile.ts` (letters only),
  and sign-up metadata never becomes profile data.
- Connected apps (MCP, `/mcp`): tools live in `src/lib/agent/tools.ts` as PURE
  functions over `analyze()` — never re-derive a number the screens show
  differently. Every tool is read-only and says so in its annotations; every
  result carries `as_of`, `time_zone` and `demo`, and cites transaction ids.
  Tokens come from Supabase Auth's OAuth 2.1 server; `/mcp` accepts only
  tokens with a `client_id` and asks Supabase Auth about each one (so
  Disconnect is immediate). Read-only is a DATABASE rule — restrictive
  policies refuse writes from any `client_id` token — so never add a write
  path for connected apps, and never refresh a token on their behalf
  (`agentFinance` in `src/lib/server/finance.ts`). New tables need the same
  restrictive write policies and a test in `schema.test.ts`. The reverse holds
  too: `currentAccount` treats a `client_id` token as signed OUT, because a
  connector token dressed up as the session cookie would otherwise reach
  actions that act outside the database (Plaid unlink, Coinbase revoke or
  refresh) before RLS can refuse anything. Return paths go through
  `safeNext`, which accepts only already-normalised same-site paths.
  The server declares `tools.listChanged: false` — keep it: the SDK's default
  `true` makes a 2026-era client hold a `subscriptions/listen` stream open,
  pinning a function to its 60-second limit every minute it stays connected.
  Supabase Auth lets ANY valid token for an account call `PUT /auth/v1/user`
  (RLS doesn't apply there), so a trigger on `auth.users` freezes password,
  email and phone (migrations `no_passwords`, `freeze_sign_in_details`).
  A future change-email feature must re-verify the person, then lift it.
- Bank sync (`src/lib/plaid/sync.ts`): a signed-in person's banks keep
  Plaid's cursor and transactions SEALED on `plaid_items.sealed_sync`
  (`sealPacked`); never store a readable transaction in the database. Saves
  go through `saveAccountPlaidSync` (version-guarded) after the response;
  `agentFinance` passes no saver. The webhook (`/api/plaid/webhook`) must
  verify Plaid's signature and may only call `plaid_item_changed` — it has
  no key to anyone's bank and must never gain one.
- The person's plan: `src/lib/finance/plan.ts` (pure: parsing, validation,
  overlay) + `src/lib/server/plan-store.ts` (cookies) +
  `src/lib/server/plan-actions.ts` (Server Actions). `getFinance()` applies it,
  so screens never read cookies themselves. Cookie values are untrusted:
  validators are all-or-nothing. Editor forms submit via `onSubmit` +
  `startTransition`, never `<form action>`, because React resets a form after
  its action and would wipe the fields on a validation error.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
