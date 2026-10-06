"use client";

// src/components/charts/sankey-chart.tsx
//
// Income → where it went. Geometry comes from `layoutSankey`; this renders it,
// labels the outer columns in gutters (so no label ever sits on a band), and
// lights a band plus its two ends on hover or focus. Each gutter is as wide as
// its longest label, measured in the page's own font, up to a share of the
// chart, so a label is never cut off in any language; one longer than even
// that ends in "…", and the tooltip and the table say it whole.

import { useId, useMemo, useState } from "react";
import { layoutSankey, type SankeyGraph } from "@/lib/finance/sankey";
import { ChartPlaceholder, ChartTooltip, fmt, useWidth } from "./core";
import { useT } from "@/components/locale";

let measurer: CanvasRenderingContext2D | null | undefined;

/** How wide a label is drawn: 12px semibold in the page's font, measured in the browser; a fair guess before there is one. */
function labelWidth(s: string): number {
  if (measurer === undefined && typeof document !== "undefined") {
    measurer = document.createElement("canvas").getContext("2d");
    if (measurer) measurer.font = `600 12px ${getComputedStyle(document.body).fontFamily}`;
  }
  return measurer ? measurer.measureText(s).width : s.length * 7;
}

export function SankeyChart({ graph, height = 380, ariaLabel }: { graph: SankeyGraph; height?: number; ariaLabel: string }) {
  const tr = useT();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hot, setHot] = useState<{ link?: number; node?: string } | null>(null);
  const gid = useId().replace(/:/g, "");
  const narrow = width < 560;
  const top = 26;
  const widest = (column: 0 | 2, text: (n: SankeyGraph["nodes"][number]) => string) =>
    Math.max(0, ...graph.nodes.filter((n) => n.column === column).map((n) => labelWidth(text(n))));
  const cap = width * (narrow ? 0.42 : 0.3);
  // The amounts beside the right-hand names are 11px medium, a little narrower than a name.
  const amount = (n: SankeyGraph["nodes"][number]) => ` ${fmt("compact", n.value)}`;
  const withAmount = (n: SankeyGraph["nodes"][number]) => labelWidth(n.label) + labelWidth(amount(n)) * 0.9;
  // Where the names and their amounts don't all fit, every right-hand label is its name alone: the tooltip and the table carry the amounts.
  const amounts = widest(2, (n) => n.label) === 0 || Math.max(...graph.nodes.filter((n) => n.column === 2).map(withAmount)) + 10 <= cap;
  const gutterL = Math.round(Math.min(cap, Math.max(narrow ? 76 : 104, widest(0, (n) => n.label) + 12)));
  const gutterR = Math.round(
    Math.min(cap, Math.max(narrow ? 104 : 150, (amounts ? Math.max(0, ...graph.nodes.filter((n) => n.column === 2).map(withAmount)) : widest(2, (n) => n.label)) + 10)),
  );
  /** `s`, or as much of it as fits in `room` and an ellipsis. */
  const fit = (s: string, room: number) => {
    if (labelWidth(s) <= room) return s;
    let cut = s;
    while (cut.length > 1 && labelWidth(`${cut}…`) > room) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  };

  const layout = useMemo(() => {
    if (width === 0) return null;
    return layoutSankey(graph, {
      width,
      height: height - top - 6,
      nodeWidth: narrow ? 10 : 14,
      padding: narrow ? 8 : 12,
      left: gutterL,
      right: gutterR,
    });
  }, [graph, width, height, narrow, gutterL, gutterR]);

  const isLit = (source: string, target: string, i: number) =>
    hot === null || hot.link === i || hot.node === source || hot.node === target;

  const tip = useMemo(() => {
    if (!layout || !hot) return null;
    if (hot.link !== undefined) {
      const l = layout.links[hot.link]!;
      const s = layout.nodes.find((n) => n.id === l.source)!;
      const t = layout.nodes.find((n) => n.id === l.target)!;
      const share = graph.total > 0 ? Math.round((l.value / graph.total) * 100) : 0;
      return {
        x: (s.x + t.x) / 2,
        title: `${s.label} → ${t.label}`,
        rows: [{ color: l.color, key: "dot" as const, label: tr("{pct}% of income", { pct: share }), value: fmt("money0", l.value) }],
      };
    }
    const n = layout.nodes.find((x) => x.id === hot.node);
    if (!n) return null;
    const share = graph.total > 0 ? Math.round((n.value / graph.total) * 100) : 0;
    return { x: n.x, title: n.label, rows: [{ color: n.color, key: "dot" as const, label: tr("{pct}% of income", { pct: share }), value: fmt("money0", n.value) }] };
  }, [layout, hot, graph.total, tr]);

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {!layout ? (
        <ChartPlaceholder height={height} />
      ) : (
        <>
          <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block" onPointerLeave={() => setHot(null)}>
            <defs>
              {/* Each band fades from where the money came from to where it
                  went, so a glance reads the direction of the flow. */}
              {layout.links.map((l, i) => {
                const s = layout.nodes.find((n) => n.id === l.source)!;
                const t = layout.nodes.find((n) => n.id === l.target)!;
                return (
                  <linearGradient key={i} id={`${gid}-l${i}`} gradientUnits="userSpaceOnUse" x1={s.x + s.w} x2={t.x} y1={0} y2={0}>
                    <stop offset="0%" stopColor={s.color} />
                    <stop offset="100%" stopColor={t.color} />
                  </linearGradient>
                );
              })}
            </defs>
            <g transform={`translate(0 ${top})`}>
              {layout.links.map((l, i) => (
                <path
                  key={`${l.source}-${l.target}`}
                  d={l.path}
                  fill={`url(#${gid}-l${i})`}
                  opacity={isLit(l.source, l.target, i) ? (hot ? 0.85 : 0.58) : 0.1}
                  className="mark cursor-pointer outline-none"
                  tabIndex={0}
                  aria-label={tr("{from} to {to}: {amount}", {
                    from: layout.nodes.find((n) => n.id === l.source)?.label ?? "",
                    to: layout.nodes.find((n) => n.id === l.target)?.label ?? "",
                    amount: fmt("money0", l.value),
                  })}
                  onPointerEnter={() => setHot({ link: i })}
                  onFocus={() => setHot({ link: i })}
                  onBlur={() => setHot(null)}
                />
              ))}
              {layout.nodes.map((n) => (
                <g key={n.id} onPointerEnter={() => setHot({ node: n.id })} className="cursor-pointer">
                  <rect x={n.x} y={n.y} width={n.w} height={Math.max(2, n.h)} rx={Math.min(4, n.w / 2)} fill={n.color} />
                  {n.column === 0 ? (
                    <text x={n.x - 8} y={n.y + n.h / 2} textAnchor="end" className="fill-[var(--ink-1)] text-[12px] font-semibold">
                      <tspan x={n.x - 8} dy={n.h > 26 ? "-0.2em" : "0.32em"}>
                        {fit(n.label, gutterL - 12)}
                      </tspan>
                      {n.h > 26 ? (
                        <tspan x={n.x - 8} dy="1.25em" className="num fill-[var(--ink-3)] text-[11px] font-medium">
                          {fmt("money0", n.value)}
                        </tspan>
                      ) : null}
                    </text>
                  ) : n.column === 2 ? (
                    <text x={n.x + n.w + 8} y={n.y + n.h / 2} className="fill-[var(--ink-1)] text-[12px] font-semibold">
                      <tspan x={n.x + n.w + 8} dy="0.32em">
                        {fit(n.label, gutterR - 10 - (amounts ? labelWidth(amount(n)) * 0.9 : 0))}
                        {amounts ? <tspan className="num fill-[var(--ink-3)] text-[11px] font-medium">{amount(n)}</tspan> : null}
                      </tspan>
                    </text>
                  ) : (
                    // The middle column's name heads it, above every bar and band, and stays inside the chart.
                    <text
                      x={Math.min(Math.max(n.x + n.w / 2, labelWidth(`${n.label} ${fmt("money0", n.value)}`) / 2 + 2), width - labelWidth(`${n.label} ${fmt("money0", n.value)}`) / 2 - 2)}
                      y={-10}
                      textAnchor="middle"
                      className="fill-[var(--ink-1)] text-[12px] font-bold"
                    >
                      {`${n.label} ${fmt("money0", n.value)}`}
                    </text>
                  )}
                </g>
              ))}
            </g>
          </svg>
          {tip ? <ChartTooltip x={tip.x} y={top + 8} width={width} title={tip.title} rows={tip.rows} /> : null}
        </>
      )}
    </div>
  );
}
