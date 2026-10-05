# Prism

@DESIGN.md

- Prism is a standalone consumer finance app, a product of Bespoke
  Intelligence Solutions (BIS). It is not part of any other BIS software and
  shares no code, database, authentication or deployment with it.
- Product and company names live in `src/lib/brand.ts`; never hard-code them.
- Gates before any merge: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm build`, `pnpm test:e2e` (Playwright on the built app, desktop and
  360px: the example household, and the signed-in tests in `e2e/accounts/`).
  CI runs all five in job `verify` (`.github/workflows/ci.yml`). A new screen
  gets a row in `e2e/screens.spec.ts`; a test that needs real money (a bank,
  Coinbase, a wallet, RentCast) belongs in the unit suite, never e2e.
- Signed-in browser tests (owner-approved 2026-10-05) run ONLY on the LOCAL
  Supabase stack (`supabase/config.toml`, rebuilt from `supabase/migrations`
  on every `supabase start`; CI pins the CLI). `e2e/accounts/stack.ts`
  refuses any address that isn't loopback, any key that isn't publishable and
  anything naming production, before a server starts: never point them at a
  hosted project, never hand them a secret or service-role key, and make
  every account through the sign-in form (`signIn`, the code read from the
  stack's Mailpit). Each test signs up its own fresh account and brings its
  money through the CSV importer (`importRows`), so tests never share state.
  The signed-in server gets a vault key made up per run, and alert emails
  switched on with a placeholder Resend key and a job secret no test is
  given, so nothing can send. Without the stack a local run leaves them out
  with a note; CI refuses to. A save that a person makes and reads back
  belongs here as well as in the unit suite: the first run found a split
  rule dropped on save and an Undo lost with the last row, both of which the
  unit tests had passed.
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
  money are never shown together. A brokerage account connects through the
  investment link (`LinkKind` in `src/lib/plaid/client.ts`: Investments
  required, transactions optional), because Plaid's Transactions never covers
  investment accounts and a link shows only what supports every required
  product. A connection whose accounts all hold investments has no
  transactions, so Plaid refusing them is no outage (`holdingsOnly`), and
  never for a connection with a bank or card account in it.
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
  household the person's own (`isLive`), never the demo. People find them
  through `AddWhatYouOwn` on Net worth (a tile per kind, above the accounts
  until something is added), Overview's "Add your home or car" while nothing
  is, and Connections' home and car entries; `addLink(kind)` opens the form
  with that kind chosen. Keep a way in that visible: a home tucked behind a
  small Add was missed by the owner. The profile's
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
  `search`/`fetch` (`src/lib/agent/research.ts`) are ChatGPT deep research's
  pair: keep their names and shapes exactly as OpenAI specifies, build every
  document from the same functions the screens use, and keep each document's
  link pointing at a page that shows the SAME figures (a category or merchant
  covers the Spending page's 12M view). Anything identifying in a link goes
  in the `#fragment` (`ledgerHash`), never the query string.
- Venmo, PayPal and Cash App (`src/lib/finance/p2p.ts`): the files are read in
  the browser and never uploaded; only matches travel, and the server re-checks
  each against the person's own lines (`validP2pMatch`). Names and notes are
  OTHER people's words: keep them cleaned (`cleanText`), sealed
  (`profiles.sealed_p2p_notes`), out of the household and the morning job, and
  presented to connected apps as data, never instructions.
- Spanish (`src/lib/i18n`): every sentence a person reads goes through a
  translator `t`, and its English IS the key (`t("Spent this month")`); the
  Spanish is in `es/`, one file per part of the app (a sentence two parts
  share goes in `es/core.ts`; the test refuses one given twice). Server components and actions take `await getT()`,
  client components `useT()`, and shared server-safe components and pure
  functions take a `t` prop or argument that defaults to English (`EN`), so
  connected apps and tests stay English until they're asked otherwise. The
  alert job has no request to ask: it writes in `profiles.language`, which
  the person's own visit keeps in step with the page (`rememberLanguage` in
  `finance.ts`, only when it moved, never a connected app), and a snapshot's
  pre-worded alerts carry the language they're in (`AlertSnapshot.lang`). Write WHOLE sentences with `{names}` (`t("{who} owes you
  {amount}", …)`), never English fragments glued together, and a separate
  sentence for one and for many. A month mid-sentence is lower case in
  Spanish: pass `monthLong(d, t.locale)` and let a Spanish sentence that
  starts with it write `{Month}`. Dates take `t.locale` (`format.ts`); amounts
  stay `$1,234.56`. A sentence defined away from where it's shown (a nav
  label, a category, a validation message) is marked `msg("…")` and
  translated where it's shown. `i18n.test.ts` fails on a sentence with no
  Spanish, a name the Spanish drops, or Spanish nobody asks for, and
  `e2e/spanish.spec.ts` checks the toggle and that Spanish never scrolls
  sideways at 360px (it found a grid sized to "Comida y restaurantes" and
  Sankey labels cut short). The choice is the `prism-lang` cookie, set by a
  server action (`language-actions.ts`), else the browser's
  Accept-Language. Translated so far: the shell, sign-in, Overview, Spending,
  Cash flow, Budgets, Goals, Net worth, Future, Your year, Taxes, Connections
  (with its imports), Account, the household, app consent, unsubscribe, and
  alert and recap emails and push; the privacy policy and terms wait for a
  lawyer. A screen still only in English is listed in
  `ENGLISH_ONLY` (`locale.ts`), which marks its content `lang="en"` inside a
  Spanish page so a screen reader reads it in an English voice: take it off
  the list in the same change that translates it.
- Amazon orders (`src/lib/finance/orders.ts`): the same shape as the payment
  notes above. The order history is read in the browser and never uploaded;
  only matches travel, a batch at a time (`ORDER_LIMITS.batch`), and the
  server re-checks each against the person's own Amazon lines, the items
  adding up to the charge to the cent (`validOrderMatch`). Item names are
  sellers' words: cleaned, sealed (`profiles.sealed_order_notes`), out of the
  household and the morning job, data to connected apps, never instructions.
- Splits, tags and who owes you (`src/lib/finance/details.ts`,
  `profiles.sealed_txn_details`): keyed by the id the BANK gave a line, never a
  part's (`<id>~<n>`). A split becomes its parts after the category fixes, so
  the analysis needs no special case; anything that looks for what REPEATS
  must see whole lines (`wholeLines`; `detectRecurring` does it itself), and
  anything matching a stream's `transactionIds` must match `t.split?.of ??
  t.id`. Parts that no longer add up to the bank's amount are set aside,
  never stretched. Owed is counted once, on part 1. Applied in the person's
  own view and the morning job (so alert emails agree); the household gets
  their lines from BEFORE them (`undetailed` from `moneyFor`), so every member
  sees the same figures against a shared budget. A split that follows a shop
  (`TxnDetails.rules`) is kept as shares summing to exactly `WHOLE_SHARE`,
  keyed by `ruleKey` (normalizeMerchant, the same grouping as recurring.ts),
  and applied by largest remainder so parts always add up; a line's own split
  or `whole: true` always wins over it. Reminders about what's owed are
  written in the browser and handed to the share sheet or the clipboard:
  Prism never sends a message to anyone on a person's behalf.
- Left out of the totals (same record: `TxnDetail.out` for a line,
  `TxnDetails.hidden` for an account's id): `applyDetails` marks such lines
  `excluded`, and `isSpending` / `isIncome` in `cashflow.ts` are the ONE place
  every total asks — use them, never `isSpendCategory(t.category)` or
  `t.category === "income"` on a transaction, or a left-out line counts again.
  What looks for what REPEATS and the balance forecast deliberately ignore the
  mark: the money still moved. `hideAccounts` runs AFTER `applyPlan` (a goal
  can still follow a left-out account) and moves those accounts and their
  holdings to `hiddenAccounts` / `hiddenHoldings`; anything that lists a
  person's accounts rather than adds them up (Connections, transaction lists,
  the data download via `everyAccount`) must include them. The household
  never sees either flag.
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
  `alerts_languages`, `alerts_sent` and `alerts_stop`, which answer to `CRON_SECRET` (the
  database keeps its sha256 in `job_keys`, which no API role can read). Its
  figures come from `alert_snapshots`, sealed and written only by the
  person's own visit (`rememberAlerts` in `finance.ts`, never a connected app
  or the household view), kept only while their emails are on. Each alert is
  sent once by fingerprint (sha256 of person + alert id); a quiet Monday
  still sends its summary, saying so. The recap of last month rides the
  same "weekly" choice (shown as Summaries; `profiles.alert_kinds` has a
  check constraint, and widening it needs a DROP the owner must run, so a
  new kind is a migration decision, not a code one): it needs a snapshot
  taken after the month ended, goes once (`monthly:YYYY-MM`) within the
  first seven days, and says why on the 7th when it has no figures. Emails carry no images or tracking and
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
- Alerts on a device (Web Push; `src/lib/alerts/webpush.ts`, migration
  `phone_alerts`): the same news as the email, sent by the same job only
  AFTER the email went, built by `phoneAlertFor` from the email's own words
  (so amounts follow the person's choice). Encryption (RFC 8291) and VAPID
  (RFC 8292) are `node:crypto` only; keep them pinned to RFC 8291's worked
  example in `webpush.test.ts`. The VAPID key is HKDF of `CRON_SECRET`, never
  a separate variable. A push goes ONLY to a host in `PUSH_HOSTS` (Apple,
  Google, Mozilla, Microsoft) — a new one means naming it in `PUSH_SERVICES`
  on the privacy policy first (`privacy.test.ts` holds it). Subscriptions are
  sealed in `push_subscriptions`, five a person, kept only while alert emails
  are on (the `profiles_forget_alerts` trigger deletes them), written AS the
  person (`src/lib/server/phones.ts`), and reached by the job only through
  `push_due`/`push_forget`. `public/sw.js` shows notifications and opens
  same-origin paths only; never give it a fetch handler or a cache — it must
  never serve money figures from an old visit. Permission is asked only on
  the person's tap.
- Download your data (`src/app/account/export/*`, `src/lib/finance/export.ts`)
  and Your year (`/year`, `src/lib/finance/year.ts`): exports read ONLY
  `getPersonalFinance` (never the household view), refuse the demo household,
  are `private, no-store` attachments, and must never carry a token, a
  calendar link or a sealed value (`export-routes.test.ts` holds it). Text
  cells starting like a formula are prefixed with an apostrophe; amounts are
  plain numbers. `transactions.csv` must stay readable by Prism's own
  importer (`export.test.ts` round-trips it). The year counts exactly as
  `cashflow.ts` counts, starts where the records do, and compares with the
  year before only when Prism holds that whole span. Printing is always light:
  the dark tokens live under `@media screen` in `tokens.css`.
- Can I afford it? (`src/lib/finance/afford.ts`, the card on Future,
  `can_i_afford`): a scenario is the forecast plus its own money from the day
  it lands, never a second model; safe-to-spend comes from `safeToSpend`
  itself, and a raise never stands in for the next paycheck. What the person
  "usually keeps" is the last three FULL months Prism saw from their first
  day, else null and said so. It stays an answer about money, never advice
  or a judgment, and nothing a person tries is saved or sent.
- Bills that don't come every month (`detectRecurring` in
  `src/lib/finance/recurring.ts`, `setAside`, the card on Future,
  `upcoming_bills`): every three, six or twelve months, found over up to two
  years (`LONG_LOOKBACK_DAYS`) and ONLY when the 200-day monthly-and-faster
  path finds nothing, so those streams never change. Money going out only,
  never `NOT_LONG` (transfers, meals, trips); every three months needs three
  charges; two charges alone must be within 30% of the latest; a missed
  renewal stops the bill (`grace`, never a second cycle); the amount expected
  is the latest; and the kind is always "bill", never "subscription". The
  monthly set-aside comes only from `setAside`, so the screen and the
  connectors agree. Loosening any of these rules needs a test that a
  lookalike (a store visited twice a year apart) still isn't a bill.
- Paying off what you owe (`src/lib/finance/payoff.ts`, the card on Net
  worth, `plan_debt_payoff`): one arithmetic for the screen and the
  connectors. A rate or a payment is the lender's (`Account.liability`) or
  the person's, NEVER a guess; a debt missing one is asked about, not
  planned. A card starts in the plan only when it charged interest in the
  last 65 days (`chargedInterest`: the bank's `interestCharge`, or the words
  on the line); loans always. Nothing is saved, and it describes both orders
  without recommending one. A debt whose payment doesn't cover its interest
  is "stuck" and said so, and a plan whose pot doesn't cover the month's
  interest stops; never let the simulation run on growing balances.
- Your taxes (`/taxes`, `src/lib/finance/taxes.ts`, `taxes.csv`,
  `get_tax_summary`, the `taxes:<year>` research document): it FINDS and
  never advises. Never add up a deduction, estimate a tax or call a figure
  deductible; every section names the form that holds the official figure.
  The bank's `taxHint` counts only while the person hasn't re-filed the line
  (`bankCategory` unset); names match whole words, only in categories where
  they can mean what they say, and a false friend found in the wild becomes a
  refusal with a test. A campaign or party is never a gift to charity. A note
  on an app payment counts only when the person wrote it (`dir: "to"`), and
  never for gifts. Dated tax rules in the copy (the 2026 gift deduction for
  people who don't itemize) are gated by year; check them each January.
- Production check (`.github/workflows/production-check.yml`,
  `src/lib/ops/production-check.ts`, run by Node as TypeScript with no
  install, so it imports only Node's own modules): after each production
  deploy and every six hours; a failure opens a `production-check` issue.
  The repo is PUBLIC: run it with `--public` there, so a failing protective
  check (`sensitive`) is never named or described in an issue or a log. A new
  door that must stay shut gets a check here, marked sensitive. `/api/health`
  (`src/lib/server/health.ts`) must stay free of anything about anyone; the
  alert job records each run through `job_ran` (counts only, one row a job).
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
