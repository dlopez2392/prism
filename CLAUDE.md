# Prism

@DESIGN.md

- Prism is a standalone consumer finance app, a product of Bespoke
  Intelligence Solutions (BIS). It is not part of any other BIS software and
  shares no code, database, authentication or deployment with it.
- Product and company names live in `src/lib/brand.ts`; never hard-code them.
- Gates before any merge: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm build`. CI runs all four (`.github/workflows/ci.yml`, job `verify`).
- **`main` is protected by a GitHub ruleset (since 2026-09-29), with no
  bypass, the owner included.** Changes arrive only through a pull request
  whose `verify` check is green on its head commit and whose branch is up to
  date with `main`; force-pushes and deletion are refused. Work on a branch,
  open a PR, and merge (squash) only after reading the check runs for the
  head commit, never inferring from an earlier run. Merging deploys
  production. Never ask for the rule to be loosened to ship faster.
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
- The vault key is a KEYRING (`vaultKey()` in `src/lib/server/vault.ts`):
  `PRISM_VAULT_KEY`, then `PRISM_VAULT_KEY_2`, `_3`… The highest number seals,
  every number opens. With ONE key, seals keep their original formats (bare
  base64url, `z1.`) so a deploy rewrites nothing and a rollback still reads
  everything; only during a rotation (two keys or more) does a seal name its
  key (`j2.<id>.` / `z2.<id>.`). Seals the current key didn't make are then
  sealed again after the person's own visit
  (`reseal` from `loadAccount`, scheduled with `after()` in `readSources`,
  NEVER from a connected app), each write guarded by the exact value it
  replaces and never moving a version. A new sealed column must join
  `staleSeals` in `account-store.ts` and the README census, or a rotation
  strands it. Replacing the key is the README's "Replacing the vault key".
- Category fixes (`src/lib/finance/category-rules.ts`): a person's own
  categories for a transaction, or for every transaction at a merchant
  (a one-transaction fix wins). They live SEALED in
  `profiles.sealed_category_rules` (merchant names are bank data), need a
  signed-in account (no device copy), and are applied ONCE, in `loadPlaid`,
  before budgets are drafted, so every chart, insight, forecast and
  connected-app answer agrees. A fixed transaction keeps `bankCategory`;
  money going out is never income, whatever is stored. Saves go through
  `fixCategory`, which re-reads the stored fixes strictly and never writes
  over fixes it couldn't read.
- Things added by hand (`src/lib/finance/manual.ts`): a home, a vehicle,
  anything else owned, or money owed, SEALED in `profiles.sealed_manual_items`,
  one value per month carried forward (so trends work), account-only, merged
  in `moneyFor` under the "Added by you" institution. Any of them makes the
  household the person's own (`isLive`), never the demo. The profile's
  sealed columns re-seal in ONE write guarded by `updated_at` (`staleSeals`).
- Households (`supabase/migrations/20260930000000_households.sql`,
  `src/lib/finance/household.ts`): up to four adults, each with their OWN
  account, sign-in and two-step code. DATA IS SHARED, NEVER ACCESS: the one
  way to another member's money is `household_shared_money()`, which returns
  their last STORED sealed copies (never `sealed_token`), only for bank
  connections they share something from (not even the bank's name
  otherwise), and nothing to a connected app or a session short of the
  second step. Nobody's visit syncs anyone else's bank. Each person shares
  account by account on Connections (`shared_accounts`); a share needs a
  household, joining or starting one clears any old shares (private until
  shared), and leaving deletes them at once. Invitations are a link the
  inviter sends themselves: the secret rides after `#`, the database keeps
  its sha256, and only the invited email can use it, once, for 7 days. The
  Me / Household switch is the `prism-view` cookie; `getFinance()` follows it
  and `getPersonalFinance()` never does — Connections and the Account page
  are always the person's own. The Household view carries no credit score or
  other people's holdings, and its transactions and items aren't editable
  (fix categories and add items from Me).
- A shared Coinbase (`supabase/migrations/20260930150000_share_coinbase.sql`)
  reaches the household as ONE number, its total value, sealed in
  `coinbase_links.sealed_snapshot` and copied only on the owner's own visits
  (`rememberCoinbase`: after the response, from a live load, at most every
  ten minutes; never from a connected app). The database keeps that copy
  only while Coinbase is shared: a trigger blanks any copy written without a
  share, stopping the share (or leaving) wipes it, and disconnecting
  Coinbase deletes the share so a reconnect starts private. It is in
  `staleSeals` and the README census. Someone's hand-added items reach the
  household only when they share a "manual-…" item, never merely because
  they share something without a bank connection.
- Household budgets and goals (`supabase/migrations/20260930120000_household_plan.sql`):
  ONE plan per household, on the `households` row, the same JSON and the same
  all-or-nothing validators as a person's own. Budgets and Goals follow the
  switch; in the Household view budgets pace what the household spends from
  SHARED accounts only, drafted with `draftBudgets` until someone sets them.
  Every member may change them, only through `household_plan()` /
  `set_household_budgets` / `set_household_goals` (a person, not a connected
  app, past the second step; no connected app reads the row at all). Each
  list has a version: a write names the version it was made from or is
  refused (40001). Budgets are a whole-list edit, so a stale save is refused
  and the newer list shown ("Sam changed these budgets…"); a goal edit is
  applied to the LATEST goals and retried once, so nobody's other goals are
  ever put back. Forms carry `scope=household` (and budgets a `version`);
  the actions never infer the scope from the view cookie. The plan stays
  with the household when someone leaves.
- In the Household view EVERY id — the viewer's own included — is
  `<owner userId>:<id>` (`householdId`), so an id means the same account to
  every member. Anything a household stores about an account (a goal's
  `accountId`) uses that form.
- A goal can follow an account (`Goal.accountId`, `followAccounts` in
  `finance/plan.ts`, applied in `applyPlan` and for household goals in the
  loader): `saved` and `history` then come from its balance, clamped at 0.
  Only savings, checking, investment, retirement and crypto accounts
  (`isTrackable`) — never a home's value or a debt — and one account feeds
  one goal (checked in `saveGoal`). If the account goes away, the goal keeps
  the stored `saved` (the balance when it was linked) and the card says so.
  Goal lists are written exactly as `validGoals` returns them.
- Connecting real money needs an account (`src/lib/linking.ts`). With
  accounts on, the link-token, exchange and both Coinbase routes refuse a
  signed-out caller BEFORE Plaid or Coinbase is asked for anything, and the
  Connect buttons send them to `/sign-in?why=bank|coinbase&next=…`. With
  accounts off, only Plaid's sandbox links into the device cookie. Never
  write a new `prism-vault` or `prism-coinbase` cookie for anything real: the
  cookie readers stay only for links made before this rule, until sign-in
  moves them into the account. `link-routes.test.ts` and
  `coinbase/routes.test.ts` hold every gate.
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
  (`sealPacked`); never store a readable transaction in the database. The
  calendar feed's snapshot is sealed too (`sealFeedSnapshot`). Saves
  go through `saveAccountPlaidSync` (version-guarded) after the response;
  `agentFinance` passes no saver. The webhook (`/api/plaid/webhook`) must
  verify Plaid's signature and may only call `plaid_item_changed` and
  `plaid_bank_warning` — it has no key to anyone's bank and must never gain one.
- Alert emails (`src/lib/alerts/*`, migration `alert_emails`): opt-in on the
  Account page. The daily job (`/api/cron/alerts`, Vercel Cron) holds no key
  to anyone's data: it reaches the database ONLY through `alerts_due`,
  `alerts_sent` and `alerts_stop`, which answer to `CRON_SECRET` (the
  database keeps its sha256 in `job_keys`, which no API role can read). Its
  figures come from `alert_snapshots`, sealed and written only by the
  person's own visit (`rememberAlerts` in `finance.ts`, never a connected app
  or the household view), kept only while their emails are on. Each alert is
  sent once by fingerprint (sha256 of person + alert id); a quiet Monday
  still sends its summary, saying so. Emails carry no images or tracking and
  one-click unsubscribe (HMAC of `CRON_SECRET`). The MORNING CHECK
  (`src/lib/alerts/refresh.ts`, migration `alert_refresh`, owner-approved
  2026-10-01) is the one place Prism reads a bank without its owner present:
  only with `profiles.alert_refresh` on, never with Coinbase linked (its
  refresh token is single-use), sealed sources only through
  `alerts_sources`, Plaid asked for balances and new transactions only
  (`PlaidSync.minimal`: no holdings, no liabilities), wallets never re-read
  (`WalletSource.offline`), and the only writes a bank's sealed copy over the
  version read (`alerts_save_sync`) and the snapshot. Never give the job a
  service-role key, never widen what it reads or writes beyond that, and keep
  amounts out of an email whose owner turned them off.
- Bank redirects (OAuth banks): `/connections/return` is the address
  allow-listed with Plaid (`RETURN_PATH`), so never move or rename it. It
  resumes Link with the SAME Link token, kept in the httpOnly
  `__Host-prism-bank-return` cookie (`src/lib/plaid/return.ts`), never in
  script-readable storage, and with `window.location.href` untouched.
  `redirectUriFor` sends `PLAID_REDIRECT_URI` only when it is exactly this
  request's origin + `RETURN_PATH`. Plaid refuses Link for any address it
  hasn't allow-listed, so when it does, link-token retries once without the
  address and logs why: a missed dashboard step must never stop linking.
  Clear the cookie with `clearedReturnCookie()`, never a bare delete, because
  a browser ignores a `__Host-` clear that isn't Secure with Path=/.
  `exchange` clears it once a bank is saved.
- Two-step sign-in (authenticator app, TOTP; migration `two_step_sign_in`):
  the DATABASE enforces it. Once `profiles.totp_factor_id` names a verified
  factor, restrictive policies on every table (and `delete_my_account`) refuse
  a session that hasn't passed THAT factor — read from `auth.sessions`, not
  just the token's `aal` — so `second_step_pending()` is the one truth, and
  `currentAccount` treats such a session as signed out (`awaitingSecondStep`
  sends it to `/sign-in/two-step`). New tables need the same restrictive
  policy and a test. Codes are checked in the BROWSER
  (`src/lib/supabase/browser.ts`), never in a server action: Supabase refuses
  a challenge and a verify from different addresses
  (`mfa_ip_address_mismatch`), and a server's egress address isn't stable.
  The server only enrolls, records and removes: `registerFactor` works only
  for a session that just passed that factor (trigger
  `check_totp_registration`), and `turnOff` requires a TOTP entry in the
  token's `amr` from the last five minutes, then clears the record BEFORE
  unenrolling. Only a code Supabase compared and refused may be called
  "didn't match"; a failed connection must say so.
- Privacy policy (`/privacy`, facts in `src/lib/privacy.ts`): it states what
  the code does, so keep them in step. When a change collects, stores or
  shares something new, or adds a service provider, update the page in the
  same commit and move `POLICY_UPDATED`. `privacy.test.ts` fails on any cookie
  or browser-storage key the policy doesn't declare. The contact address
  (`BRAND.privacyEmail`) must be a mailbox someone reads.
- Terms of Service (`/terms`, facts in `src/lib/terms.ts`, layout shared with
  `/privacy` through `src/components/legal.tsx`): plain words, and every
  promise it makes is held to the code. `terms.test.ts` fails if Link asks
  for a Plaid product outside `READ_ONLY_PLAID_PRODUCTS`, a Coinbase scope
  that doesn't only read, a country other than the US, or if the sign-in
  form or the footer stops linking to it. Adding a product that could move
  money or reveal account numbers means changing the Terms and the privacy
  policy FIRST, with a new `TERMS_UPDATED`. Arbitration, the Texas venue and
  the "free today" promise are the owner's decisions, for a lawyer to review.
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
