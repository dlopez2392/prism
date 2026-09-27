# Prism — Design Contract

> Prism is the consumer personal-finance app in `apps/finance`. It is a
> separate product from the BIS Platform and has its own identity; the root
> `DESIGN.md` (BIS: violet-only accent, operator UI) does **not** govern this
> app. This file does. If a change conflicts with it, stop and flag it.
> Tokens: `src/styles/tokens.css`. Components consume tokens ONLY.

## Identity

- **Vibrant, visual, optimistic.** Money apps default to anxious reds and
  spreadsheet greys; Prism shows a person's money in full colour. Every screen
  leads with a picture, then the numbers, then the rows.
- Dark and light are both first-class. The OS preference picks the first-run
  theme; the toggle in the top bar remembers the choice per device.
- Voice: plain words a person reads on their phone in line for coffee.
  "You have $412 safe to spend until Friday", not "Discretionary liquidity".
  No finance jargon without a one-line explanation. Never shame spending.

## Foundations

**Surfaces (4 steps, never more):** `--surface-0` page → `--surface-1` cards →
`--surface-2` nested panels/inputs → `--surface-3` hover/raised. Borders:
`--line`, `--line-strong`. Depth comes from the prism ground (three glows —
violet, pink, cyan — fixed, sized in viewport units) and `--shadow-card`.

**Type:** one family — Plus Jakarta Sans — for everything, hero figures
included. Hierarchy by weight first, size second, colour last. Aligned
columns (tables, axis ticks) use `.num` (tabular figures); big standalone
numbers keep proportional figures.

**Shape & motion:** radii 20px (cards), 12px (controls), 999px (pills) — no
other values for components (a control nested in a padded control derives its
radius from the token, e.g. `calc(var(--radius-ctl) - 4px)`). Chart marks
follow the chart spec below instead (4px data-ends, 3px legend swatches). Spacing on a 4px grid. 150ms hovers, 250ms panels, charts draw
in once on mount, `prefers-reduced-motion` respected, nothing animates on
scroll.

## Colour — the four jobs

Every colour on a chart does exactly one job:

| Job | Tokens | Rule |
|---|---|---|
| Identity (categorical) | `--c-1` … `--c-8`, `--c-other` | Fixed order, assigned by entity (a category keeps its colour everywhere), never cycled. A 9th thing folds into "Other". |
| Polarity (in vs out) | `--flow-in` (cool), `--flow-out` (warm) | Only where the chart IS money-in vs money-out. |
| Magnitude (sequential) | `--seq-0` … `--seq-5` | One hue, light→dark (flips in dark mode). Heatmaps only. |
| Status | `--good`, `--warn`, `--serious`, `--crit` | Reserved meaning. Always icon + word, never colour alone. |

The categorical order is the colour-blind-safety mechanism: violet, pink,
amber, cyan, orange, emerald, blue, lime. Validated in both modes against
`--surface-1` (worst adjacent CVD ΔE 10.1, normal-vision ΔE ≥ 20.1, every slot
≥ 3:1). Changing a hex or the order means re-running the validator and
recording the new numbers here.

Category → slot is fixed in `src/lib/finance/categories.ts`: Housing 1,
Food & dining 2, Transport 3, Shopping 4, Fun 5, Health 6, Travel 7,
Bills 8, everything else Other.

**Hero gradient:** `--gradient-prism`, exactly one per screen (the screen's
headline card), marked `data-hero` in code. Its stops are deep jewel tones so
white text clears 4.5:1 at every stop (min 6.0) and `--on-hero-soft` does too
(min 5.1). `--gradient-text` is for the greeting name and wordmark only.

**Text contrast (measured):** body ink ≥ 8.7:1, muted ink ≥ 4.9:1 on every
surface. Accent as text uses `--accent-ink` (5.7:1 light, 6.6:1 dark), never
`--accent`. Filled buttons use `--button` in both modes (white label 5.7:1),
because dark mode's brighter `--accent` would give white only 4.2:1. Labels
inside a coloured chart mark sit on a surface chip — no series hue gives white
or ink 4.5:1 across all eight slots.

## Charts

- Thin marks: bars ≤ 24px with 4px rounded data-ends, square at the baseline;
  2px lines with round joins; ≥ 8px end markers with a 2px surface ring.
- 2px surface gap between touching fills (stacked segments, donut slices,
  adjacent bars). Never a stroke drawn around a mark to separate it.
- Area fills are a ~12% wash of the series hue — never a saturated block.
- Hairline, solid gridlines in `--grid`; axis rule in `--axis`. Dashes are
  reserved for projections (the future is dashed, the past is solid).
- One y-axis. Never a dual axis.
- Legend for ≥ 2 series, with swatches that mirror the mark. Text wears ink
  tokens, never the series colour.
- Every chart ships a hover/focus tooltip AND a "View as table" twin — the
  tooltip enhances, the table guarantees.
- Label selectively: the endpoint, the extreme, the one number the story is
  about. Never a number on every point.

## Rules (enforced in review)

1. Every metric ships with context — a delta, a sparkline, or a period label.
2. New components use the existing 4 surfaces.
3. Status is never colour alone — dot or icon + word.
4. Every screen has designed loaded / empty / error states. Empty states sell
   the feature: one sentence of what appears here + the action that causes it.
5. Loading = skeletons shaped like the content. No spinners.
6. One hero gradient per screen (`data-hero`).
7. Insights show their work: every generated insight carries the transactions
   it was computed from, one tap away ("Show the math").
8. Money is integer cents end to end; formatting happens only at the edge.
9. Mobile first: every screen works at 360px with a bottom tab bar; the
   sidebar appears at ≥ 1024px. No horizontal page scroll.
10. Provider-neutral: no screen may name the aggregator in the UI except the
    Connections screen. The data layer maps every provider onto
    `src/lib/finance/types.ts`.

## Definition of done for any UI change

- [ ] Tokens only — no hard-coded colours, radii, shadows
- [ ] Renders correctly in light AND dark (`data-theme`)
- [ ] Charts: tooltip on hover and keyboard focus, table view, legend rules
- [ ] Loaded, empty and error states
- [ ] Keyboard: visible focus ring, Esc closes overlays
- [ ] 360px wide with no horizontal scroll
- [ ] Copy passes the "in line for coffee" read
