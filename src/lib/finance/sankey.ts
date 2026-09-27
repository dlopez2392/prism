// src/lib/finance/sankey.ts
//
// The cash-flow Sankey: income sources → "Income" → where it went (spending
// categories, plus what was saved). Reviewers call Monarch's version its most
// screenshotted screen; this is ours. Two parts, both pure:
//
//   buildCashFlowSankey — the graph (nodes, links, values), from totals
//   layoutSankey        — geometry for a given width/height, three columns
//
// Every column carries the same total, so the picture balances: when spending
// beat income, the gap arrives on the left as "From savings" instead of the
// right column silently being taller than the left.

import { CATEGORIES, categoryColor, SPEND_CATEGORIES } from "./categories";
import type { IncomeSource } from "./cashflow";
import type { Cents, SpendCategoryId } from "./types";

export type SankeyNode = {
  id: string;
  label: string;
  column: 0 | 1 | 2;
  value: Cents;
  color: string;
};

export type SankeyLink = { source: string; target: string; value: Cents };

export type SankeyGraph = { nodes: SankeyNode[]; links: SankeyLink[]; total: Cents };

export function buildCashFlowSankey(
  sources: IncomeSource[],
  spending: Record<SpendCategoryId, Cents>,
): SankeyGraph {
  const income = sources.reduce((s, x) => s + Math.max(0, x.amount), 0);
  const cats = SPEND_CATEGORIES.filter((c) => spending[c] > 0);
  const spent = cats.reduce((s, c) => s + spending[c], 0);
  const saved = income - spent;

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  for (const [i, s] of sources.entries()) {
    if (s.amount <= 0) continue;
    const id = `src-${i}`;
    nodes.push({ id, label: s.name, column: 0, value: s.amount, color: "var(--flow-in)" });
    links.push({ source: id, target: "income", value: s.amount });
  }
  if (saved < 0) {
    nodes.push({ id: "from-savings", label: "From savings", column: 0, value: -saved, color: "var(--flow-out)" });
    links.push({ source: "from-savings", target: "income", value: -saved });
  }
  const total = Math.max(income, spent);
  nodes.push({ id: "income", label: "Income", column: 1, value: total, color: "var(--accent)" });
  for (const c of cats) {
    nodes.push({ id: c, label: CATEGORIES[c].label, column: 2, value: spending[c], color: categoryColor(c) });
    links.push({ source: "income", target: c, value: spending[c] });
  }
  if (saved > 0) {
    nodes.push({ id: "saved", label: "Saved", column: 2, value: saved, color: "var(--flow-in)" });
    links.push({ source: "income", target: "saved", value: saved });
  }
  return { nodes, links, total };
}

export type PlacedNode = SankeyNode & { x: number; y: number; w: number; h: number };
export type PlacedLink = SankeyLink & {
  path: string;
  color: string;
  /** Band thickness in px — used for the hover hit target. */
  width: number;
};

export type SankeyLayout = { nodes: PlacedNode[]; links: PlacedLink[] };

export function layoutSankey(
  graph: SankeyGraph,
  box: { width: number; height: number; nodeWidth?: number; padding?: number; left?: number; right?: number },
): SankeyLayout {
  const nodeWidth = box.nodeWidth ?? 12;
  const padding = box.padding ?? 10;
  const left = box.left ?? 0;
  const right = box.right ?? 0;
  const columns: SankeyNode[][] = [[], [], []];
  for (const n of graph.nodes) columns[n.column]!.push(n);

  const usable = (col: SankeyNode[]) => box.height - padding * Math.max(0, col.length - 1);
  const ky = Math.min(...columns.filter((c) => c.length).map((c) => usable(c) / Math.max(1, sum(c))));
  const xs = [left, left + (box.width - left - right - nodeWidth) / 2, box.width - right - nodeWidth];

  const placed = new Map<string, PlacedNode>();
  for (const [ci, col] of columns.entries()) {
    const heights = col.map((n) => Math.max(1, n.value * ky));
    const stack = heights.reduce((s, h) => s + h, 0) + padding * Math.max(0, col.length - 1);
    let y = (box.height - stack) / 2;
    for (const [i, n] of col.entries()) {
      placed.set(n.id, { ...n, x: xs[ci]!, y, w: nodeWidth, h: heights[i]! });
      y += heights[i]! + padding;
    }
  }

  const outOffset = new Map<string, number>();
  const inOffset = new Map<string, number>();
  const links: PlacedLink[] = graph.links.map((l) => {
    const s = placed.get(l.source)!;
    const t = placed.get(l.target)!;
    const w = Math.max(1, l.value * ky);
    const sy = s.y + (outOffset.get(s.id) ?? 0);
    const ty = t.y + (inOffset.get(t.id) ?? 0);
    outOffset.set(s.id, (outOffset.get(s.id) ?? 0) + w);
    inOffset.set(t.id, (inOffset.get(t.id) ?? 0) + w);
    const x0 = s.x + s.w;
    const x1 = t.x;
    const xm = (x0 + x1) / 2;
    const path = [
      `M${f(x0)},${f(sy)}`,
      `C${f(xm)},${f(sy)} ${f(xm)},${f(ty)} ${f(x1)},${f(ty)}`,
      `L${f(x1)},${f(ty + w)}`,
      `C${f(xm)},${f(ty + w)} ${f(xm)},${f(sy + w)} ${f(x0)},${f(sy + w)}`,
      "Z",
    ].join(" ");
    // A band takes the colour of its far end: where the money went.
    const color = t.column === 2 ? t.color : s.color;
    return { ...l, path, color, width: w };
  });

  return { nodes: [...placed.values()], links };
}

function sum(col: SankeyNode[]): number {
  return col.reduce((s, n) => s + n.value, 0);
}

function f(n: number): string {
  return n.toFixed(1);
}
