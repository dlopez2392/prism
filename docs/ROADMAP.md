# Prism roadmap

Owner: Bespoke Intelligence Solutions. Last updated 2026-09-30 (**real banks live: Plaid production since 2026-09-30**, with "Sign in again" for a bank that stops updating; history imported from Mint, Monarch or a spreadsheet; household views, household budgets and goals, goals that follow an account and a shared Coinbase value built 2026-09-29/30; accounts live on Supabase project `prism` since 2026-09-28; MCP server and Coinbase built).

## Committed integrations

The owner has approved these six integrations, and they are part of the plan.
Do not drop one, swap in a different provider, or start work that contradicts
one without the owner's sign-off. Each line gives the access path that
research found in September 2026 (`docs/research-2026-09-27.md`).

| # | Integration | Access path | Status |
|---|---|---|---|
| 1 | **Investment accounts through Plaid** | Plaid Investments, requested as an optional product in the same Link flow as banking. | Built: holdings map onto `Holding`, shown in the Net worth treemap |
| 2 | **Coinbase for crypto** | Coinbase sign-in (OAuth2) with the read-only `wallet:accounts:read` scope. Self-custody wallets later, read by public address. | **Built (2026-09-28):** OAuth2 with PKCE and state, `wallet:accounts:read,offline_access` only; tokens sealed in an httpOnly cookie like the Plaid vault; `src/proxy.ts` refreshes them before they lapse, because Coinbase refresh tokens work once; every wallet priced in dollars from Coinbase's public rates and shown as one crypto account with a holding per coin. **Goes live when the owner** creates an OAuth client on the Coinbase Developer Platform and sets `COINBASE_CLIENT_ID` / `COINBASE_CLIENT_SECRET` in Vercel. **Blocked on Coinbase (2026-10-04):** new OAuth clients are paused and limited to approved partners; the owner is requesting access. **Self-custody wallets built (2026-09-30):** a person adds a wallet by public address on Connections — Bitcoin through mempool.space (live, no key), Ethereum and Solana through Alchemy (off until the owner sets `ALCHEMY_API_KEY`), with only well-known tokens counted, by contract; addresses sealed and never shared with a household. **Whole Bitcoin wallets built (2026-09-30):** an xpub, ypub, zpub or descriptor; Prism derives every address itself (BIP 44/49/84/86, gap limit 20) and sends mempool.space addresses only, never the key; read after the response, claimed so it's read once; recovery phrases and private keys stopped in the browser. |
| 3 | **A credit-score partner such as Experian or SavvyMoney** | A bureau partner: Experian Connect or SavvyMoney. Brings permissible-purpose and FCRA compliance work. **Credit Karma has no way for other apps to read its data** — do not plan around it. | Planned (needs a partner agreement) |
| 4 | **A home-value service: RentCast** (owner's decision 2026-09-30, replacing ATTOM/Estated) | RentCast's automated valuation (`/v1/avm/value`): self-serve, 50 free lookups a month then $74/month for 1,000, and its API license allows storing and showing values with no attribution. ATTOM's trial is evaluation-only (no display, no storage past 24 hours) and Estated takes no new customers. **Zillow closed its public data access in 2021**, and its successor, Bridge, serves MLS members only — do not plan around Zillow. | **Hand-entered values built (2026-09-29):** a signed-in person adds their home (or a vehicle, anything else they own, or money they owe) on Net worth and updates its value when it changes; each update is that month's value, so the trend is real. **RentCast built (2026-09-30), off until the owner sets `RENTCAST_API_KEY`:** a home can keep its value up to date from its address (sealed apart from what a household is sent), estimated about once a month; a hard cap in the database (45 lookups in any 31 days to start, three homes a person, once a home a month) keeps RentCast from ever billing past the plan. |
| 5 | **Bill reminders in your calendar** | A private, per-person calendar feed (ICS) that works in Google, Apple and Outlook calendars; the Google Calendar API only if a two-way sync is ever needed. | **Stage 1 built:** "Add to calendar" on Future downloads the person's bills and paydays as an iCalendar file (one repeating series per bill, an alert they choose, amounts optionally kept off the lock screen), and the demo household has a real subscribable feed at `/calendar/demo.ics`. **Stage 2 built with accounts (2026-09-28):** a signed-in person gets a private link (`/calendar/feed/<secret>.ics`) their calendar app follows; the database keeps only the secret's sha256 and a snapshot of bills and paydays, refreshed as they use Prism; "Reset link" kills a leaked URL at once. |
| 6 | **A way for people to ask Claude or ChatGPT about their own money, read-only** | A read-only MCP server that exposes the person's own data and cites the transactions behind every answer. It never moves money and never writes data. | **Built (2026-09-28):** `/mcp` (MCP SDK v2: the 2026-07-28 protocol plus stateless 2025 serving), ten read-only tools that cite transaction ids (`get_income` added 2026-09-30); sign-in through Supabase Auth's OAuth 2.1 server with a Prism consent screen and dynamic client registration; the database refuses every write from a connected-app token; Account page lists connected apps with Disconnect (immediate). **Live (2026-09-28):** the owner switched on the OAuth server (path `/oauth/consent`, dynamic registration on) and the whole journey was verified end to end against production's project — register, consent, token, questions, write refused, password/email/phone change refused, Disconnect immediate. **ChatGPT deep research built (2026-10-01):** OpenAI's `search`/`fetch` pair over the person's money as documents, each linked to the Prism page with the same figures (product roadmap item 12). |

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
   address with Plaid and setting `PLAID_REDIRECT_URI`.
   **Live on real banks (2026-09-30):** Plaid approved production for
   Transactions, Investments and Liabilities (Liabilities as consent only, so
   nothing is fetched or billed until a feature uses it); `PLAID_ENV` and the
   production secret were switched in Vercel, and the owner's own bank linked
   and synced the same day. Production Link requires a Data Transparency
   Messaging use case on the dashboard's `default` Link customization: it is
   set to "Track and manage your finances" only, which must stay true to what
   Prism does. **Sign in again built (2026-09-30):** a bank that wants its
   owner to sign in again stays on screen as of its last sync and gets a
   "Sign in again" button (Plaid's update mode), so the same connection
   carries on and nothing is billed twice. **Card and loan due dates built
   (2026-09-30), off until the owner sets `PLAID_LIABILITIES=on`** (Plaid
   bills Liabilities per bank from the first read): each card's and loan's due
   date, minimum, statement balance and rate on Net worth, on Future, in the
   calendar and for connected apps; read at most daily, never for a connected
   app, and not shown to the household. The forecast uses them too: a
   repeating payment is tied to the card or loan it pays when its payments
   show up on both sides (out of checking, into the card, same amount, within
   three days, at least twice), and its next occurrence becomes the lender's
   due date and statement balance (or minimum, whichever the person usually
   pays), replacing the estimate rather than adding to it.
   Known limits: one connection in flight per browser (a second tab's attempt
   replaces the first), and a bank app that returns people to a DIFFERENT
   browser finds nothing to resume and asks them to start again. Keeping the
   Link token server-side by person would resume it, but only after the
   person also signs in to Prism in that other browser, so it saves one bank
   sign-in in a rare case: deferred until real use shows it happening. Also
   deferred, then **built (2026-10-01)**: warning a person BEFORE a bank's
   consent lapses (Plaid's `PENDING_DISCONNECT` webhook, a week ahead): the
   warning is kept on the bank's row (`plaid_bank_warning`), Connections shows
   "Sign in by <date>" with the button, and Overview a Heads up.
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
   until someone sets them. **Goals that follow an account built
   (2026-09-30):** any goal, personal or household, can follow a savings,
   checking, investment, retirement or crypto account, so its progress fills
   itself from the balance, with the account's real history on the chart.
   **Sharing Coinbase built (2026-09-30):** the household sees a shared
   Coinbase as its total value from the owner's last visit; Prism keeps
   that one number (sealed) only while it's shared. **Closed to connected
   apps (2026-09-30):** a connected app reads nothing of a household — not
   its members, its invitations or anyone's share list — and an invitation
   that has run out is deleted rather than kept.
5. **A fallback aggregator** (Finicity or MX) for when a bank's Plaid
   connection breaks.
6. **The committed integrations above**, with the MCP server (#6) as soon as
   accounts exist, since it needs to know whose money it is reading.
7. **Older history from another app.** **Built (2026-09-30):** a signed-in
   person imports a CSV export from Mint, Monarch or any bank spreadsheet
   (Connections → Import a file). The file is read in the browser and never
   uploaded; the columns are recognised for Mint and Monarch and matched by
   hand for anything else, with every skipped row listed by line and reason.
   Only the mapped rows travel, 2,000 at a time; the server checks every row
   again and stores them sealed, and the import shows only once every batch
   has arrived (one left unfinished for a day is removed; one that won't open
   is never removed automatically, but is listed on Connections so the person
   can remove it). An import becomes the older history of a linked bank
   account, adding only the days before that bank's own, or an account of its
   own. Category fixes apply to it; connected apps can read it; a household
   never sees it. Up to twenty imports a person, enforced by the database.
8. **Paycheck details, from the deposits themselves.** **Built (2026-09-30)**
   instead of a payroll provider (Plaid Income, Argyle and Pinwheel are built
   for lending checks): who pays you, how often, what lands, a year of it and
   the next payday, on Cash flow and for connected apps (`get_income`). Pay
   rules are recognised, not guessed from gaps — every other Friday, the 15th
   and the last day of the month, the last business day, the second Wednesday
   (Social Security) — and a payday on a weekend or a Federal Reserve holiday
   moves to the business day before, so the forecast, safe-to-spend and the
   calendar land on the real day. Income is counted by kind (pay, interest,
   dividends, benefits, tax refunds…) from the bank's own category, or the
   deposit's name when there is none.
9. **Alerts.** **In the app built (2026-10-01):** a Heads up on Overview for a
   bank that has stopped updating or will within the week, and a bill before
   payday the account won't cover; price rises stay among the insights.
   **Email built (2026-10-01):** opt-in alert emails and a Monday summary
   (Account page), sent by a daily Vercel Cron job that reaches the database
   only through functions answering to `CRON_SECRET` (no service-role key),
   from a sealed snapshot each visit leaves; Resend, one-click unsubscribe,
   no tracking. Off until the owner sets `RESEND_API_KEY`, `CRON_SECRET` and
   the secret's fingerprint (README, "Alert emails"). **Switched on in
   production (2026-10-01).** **Morning check built (2026-10-01,
   owner-approved):** with "Check my banks each morning" on (and no Coinbase
   linked), the job reads the person's banks before deciding what to send, so
   alerts don't wait on a visit: sealed sources through a secret-gated
   function, balances and new transactions only, writing back only the bank's
   copy (version-guarded) and the snapshot. **Phone app built (2026-10-01):**
   Prism installs to a Home Screen (web app manifest, icons, a service worker
   that only shows notifications), and each alert email's news also goes to
   the person's devices as an end-to-end encrypted Web Push notification
   (RFC 8291/8292 in `node:crypto`, no new dependency; VAPID key derived from
   `CRON_SECRET`). Next, if people ask for it: notifications without the
   emails (a channel choice per person), and offline reading.
10. **Your data, and your year.** **Built (2026-10-01):** "Download your data"
    on the Account page (a zip of spreadsheets and one JSON file, or just the
    transactions, which Prism's own importer reads back) and **Your year**
    (`/year`): one calendar year on one page, compared with the same stretch
    of the year before when Prism holds it, printable as a PDF. The
    tax-season view shipped as item 14. Next, if people ask for it: the year
    sent as a January email.
11. **Knowing when production breaks.** **Built (2026-10-01):** a production
    check after every deploy and every six hours, from the outside, that
    opens a GitHub issue when anything fails (and closes it when fixed),
    without describing an open door in public; `/api/health` with the live
    release, the database and the alert job's last run. Next, if it's ever
    needed: error tracking inside the app (Sentry), which would be a new
    company handling data and so a privacy-policy change first.
12. **Research with ChatGPT.** **Built (2026-10-01):** the connector answers
    ChatGPT's deep research through `search` and `fetch`, presenting the
    person's money as documents (summaries, months, years, categories,
    merchants), each linked to the Prism page with the same figures so every
    citation in a report can be checked. Next, if people ask for it: listing
    Prism in ChatGPT's plugin directory (OpenAI's review), so nobody needs
    Developer mode to connect.
13. **Venmo, PayPal and Cash App.** **Built (2026-10-04):** none of the three
    lets another app read an account, so a person adds each app's own activity
    file on Connections; it's read in the browser and never uploaded, each
    payment is matched to the bank line it caused, and only the matches are
    kept (who, and the note), sealed. Next, if people ask for it: payments
    paid from an app's own balance, which never reach a bank, as an account of
    their own.
14. **Your taxes.** **Built (2026-10-04):** `/taxes` sorts a year into what a
    US tax return asks about (pay, interest, dividends, benefits, other money
    and refunds in; gifts to charity, medical, taxes paid, mortgage, student
    loans, childcare and tuition out), each with the form that holds the
    official figure and the transactions behind it. Found by the bank's own
    category first (unless the person re-filed the line), then by name, with
    campaign gifts left out of charity. Printable, downloadable for a tax
    preparer, and answered to Claude and ChatGPT (`get_tax_summary`, the
    `taxes:<year>` research document). It finds and never advises. Next, if
    people ask for it: marking a line in or out of a section by hand, and
    the official figures from the forms themselves (a W-2 or 1099 a person
    uploads).
15. **Ask Prism, a chat inside the app.** **Planned, deferred by the owner
    (2026-10-04: "keep that plan for later").** A chat button in Prism that
    answers questions about the person's own money with the same read-only
    tools the AI connector has, so it can never disagree with the screens or
    change anything. The plan as agreed, so it can start without being
    re-decided:
    - **Signed-in people only**, never the demo household's visitors.
    - **A daily cap per person** of about 30 questions, kept in the database.
    - **A $25-a-month spending cap** set in the Anthropic Console, so the
      bill can never run past it whatever the app does.
    - **The model:** Claude's most capable (Opus) tier, about 5¢ a question
      at the prices of 2026-09-25; the Sonnet tier would roughly halve that.
      The owner chooses at build time.
    - **Before it ships:** the API key goes straight into Vercel (Production,
      marked Sensitive), and the privacy policy names Anthropic as a company
      that handles people's data, because questions and the figures behind
      them are sent to it.
16. **Can I afford it?** **Built (2026-10-04):** on Future, a purchase, a
    new monthly bill or a raise is tested as the person types against the
    60-day checking forecast (its lowest point, against zero and the
    cushion), safe-to-spend by its own rule, and what they usually keep each
    month against what their goals ask for: fits, tight or doesn't fit, with
    the reasons and the figures before and after. The arithmetic runs in the
    browser and nothing is saved. Claude and ChatGPT ask the same through
    `can_i_afford`. Next, if people ask for it: drawing the tried line on the
    forecast chart, and "afford it by when?" (the date a purchase would fit).
17. **Splits, tags and who owes you.** **Built (2026-10-04):** a person
    splits one of their own purchases across categories (every total,
    budget, chart, the tax summary and Claude count the parts; a split bill
    still forecasts as one), tags it to total a trip or a project, and notes
    who owes them for it, with an **Owed to you** list and **Paid back**.
    Sealed in their account, never shown to a household, and read by the
    morning check so alert emails agree. Next, if people ask for it: sharing
    a request for what's owed (a Venmo or a text link), splits that follow a
    merchant automatically, and tags a household shares.
18. **Browser tests in CI.** **Built (2026-10-04):** Playwright runs the
    production build on the example household at desktop and 360px phone
    widths inside the required `verify` job: every screen renders whole (no
    console error, no sideways scroll, at most one hero), navigation on both
    widths, the theme toggle, Can I afford it?, the tax summary, the
    ledger's search and links, and the doors a stranger tries. Its first run
    caught a real gap: on a phone nothing said the example household wasn't
    real money (now it does). Next, if it's ever needed: the signed-in
    journeys against a throwaway Supabase project, and visual comparisons.
