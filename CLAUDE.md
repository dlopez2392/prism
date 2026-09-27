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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
