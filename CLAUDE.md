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
- **Committed integrations (owner-approved, do not drop or substitute without
  the owner's sign-off)** — full notes in `docs/ROADMAP.md`:
  1. Investment accounts through Plaid (already built in).
  2. Coinbase for crypto (read-only OAuth).
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
  integrations above. Keep `docs/ROADMAP.md` current as items ship. The owner
  chose "not yet" on accounts (2026-09-27); if asked, the preferred region is
  US East. Budgets and goals are editable ON THE DEVICE for now.
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
