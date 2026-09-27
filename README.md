# Prism — personal finance, in full colour

A consumer budgeting and money app: link a bank, then see where money came
from, where it went, what's coming next, and how far you've come. Every screen
leads with a chart.

It is a separate product from the BIS Platform (`apps/web`) and shares only the
monorepo's tooling. Design contract: [`DESIGN.md`](./DESIGN.md). Market and
integration research: [`docs/research/2026-09-27-personal-finance-app-research.md`](../../docs/research/2026-09-27-personal-finance-app-research.md).

## Run it

```bash
pnpm install
pnpm --filter finance dev        # http://localhost:3100
```

With no configuration it runs on a **demo household**: thirteen months of one
person's (fictional) money, generated deterministically, so every chart works
before anyone shares real data.

## Link a real bank (Plaid)

1. Create a free Plaid account and copy the **sandbox** keys.
2. `cp apps/finance/.env.example apps/finance/.env.local` and fill in
   `PLAID_CLIENT_ID` and `PLAID_SECRET`.
3. Restart `dev`, press **Connect a bank**, pick any test bank and sign in with
   `user_good` / `pass_good`.

For production set `PLAID_ENV=production` and a real `PRISM_VAULT_KEY`
(`openssl rand -base64 32`); the app refuses to store tokens without one.

## Screens

| Screen | What it shows |
|---|---|
| **Overview** | Net worth hero, safe-to-spend, four headline numbers, spending pace vs last month, category donut, budget rings, evidence-backed insights, upcoming bills, recent activity |
| **Cash flow** | Income → categories → saved **Sankey**, money in vs out by month, what you kept each month (diverging), savings-rate trend |
| **Spending** | Stacked monthly bars by category, category change vs the prior period, top merchants, a year-long **calendar heatmap**, searchable ledger |
| **Budgets** | Month plan left, bullet chart (spent · projected · limit), a ring per budget with a "today" tick |
| **Future** | 60-day checking **balance forecast** with an 80% band, paydays and bills marked, safe-to-spend, subscriptions with price-rise flags |
| **Goals** | A ring per goal, progress-as-share-of-target chart with projections, a **what-if** slider |
| **Net worth** | Own vs owe over 12 months, every account with its trend, holdings **treemap**, credit-score gauge and factors |
| **Connections** | Per-institution health, how data is protected, and an honest catalogue of every integration and its real access path |

## How it's built

```
src/lib/finance/   provider-neutral model + pure analytics (cash flow, budget
                   pacing, recurring detection, forecast, Sankey, insights)
src/lib/charts/    chart geometry (scales, curves, bars, arcs, treemap)
src/lib/plaid/     dependency-free Plaid client + mapping onto the model
src/lib/server/    data loading (demo vs live) and the sealed token vault
src/components/    chart kit (SVG, no chart library) and UI blocks
src/app/           the eight screens + /api/plaid/{link-token,exchange,disconnect}
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

## Gates

```bash
pnpm --filter finance typecheck
pnpm --filter finance lint
pnpm --filter finance test       # vitest — analytics, geometry, Plaid mapping, vault
pnpm --filter finance build
```

The first three also run under the repository's `pnpm check`.

## Prototype limits (deliberate) and next steps

- **Storage:** linked-bank tokens live in an AES-256-GCM sealed, httpOnly
  cookie so the prototype needs no database. Production moves them to a
  per-user, KMS-encrypted server-side store with auth, and persists the
  `/transactions/sync` cursor so each load fetches only what changed.
- **Budgets and goals** are drafted from history (live) or seeded (demo) and
  are not yet editable or saved.
- **Next features, in order:** Plaid webhooks + stored cursor → editable
  budgets/goals with persistence → household ("yours, mine, ours") views →
  a fallback aggregator (Finicity or MX) → read-only MCP server so people can
  ask their AI assistant about their money, with the transactions cited.
