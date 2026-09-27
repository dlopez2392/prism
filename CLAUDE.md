# Prism (apps/finance)

@DESIGN.md

- This app is a separate consumer product. Its design contract is
  `apps/finance/DESIGN.md` above; the repository-root `DESIGN.md` is the BIS
  Platform's and does not apply to anything under `apps/finance`.
- It shares no runtime code, database, auth or deploy with `apps/web`. Do not
  import from `@bis/db` or `apps/web`.
- Gates for this app: `pnpm --filter finance typecheck`, `lint`, `test`
  (all three also run under the root `pnpm check`), and
  `pnpm --filter finance build`.
- Bank data: Plaid through `src/lib/plaid/*`, mapped onto
  `src/lib/finance/types.ts`. Without `PLAID_CLIENT_ID`/`PLAID_SECRET` the app
  runs on the deterministic demo household in `src/lib/finance/demo.ts`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
