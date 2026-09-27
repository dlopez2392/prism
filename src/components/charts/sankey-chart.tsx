"use client";

// apps/finance/src/components/charts/sankey-chart.tsx
//
// Income → where it went. Geometry comes from `layoutSankey`; this renders it,
// labels the outer columns in gutters (so no label ever sits on a band), and
// lights a band plus its two ends on hover or focus.

import { useId, useMemo, useState } from "react";
import { layoutSankey, type SankeyGraph } from "@/lib/finance/sankey";
import { ChartPlaceholder, ChartTooltip, fmt, useWidth } from "./core";

export function SankeyChart({ graph, height = 380, ariaLabel }: { graph: SankeyGraph; height?: number; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hot, setHot] = useState<{ link?: number; node?: string } | null>(null);
  const gid = useId().replace(/:/g, "");
  const narrow = width < 560;
  const top = 26;
  const gutterL = narrow ? 76 : 104;
  const gutterR = narrow ? 104 : 150;

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
        rows: [{ color: l.color, key: "dot" as const, label: `${share}% of income`, value: fmt("money0", l.value) }],
      };
    }
    const n = layout.nodes.find((x) => x.id === hot.node);
    if (!n) return null;
    const share = graph.total > 0 ? Math.round((n.value / graph.total) * 100) : 0;
    return { x: n.x, title: n.label, rows: [{ color: n.color, key: "dot" as const, label: `${share}% of income`, value: fmt("money0", n.value) }] };
  }, [layout, hot, graph.total]);

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
                  aria-label={`${l.source === "income" ? "Income" : layout.nodes.find((n) => n.id === l.source)?.label} to ${
                    layout.nodes.find((n) => n.id === l.target)?.label
                  }: ${fmt("money0", l.value)}`}
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
                        {n.label}
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
                        {n.label}
                        <tspan className="num fill-[var(--ink-3)] text-[11px] font-medium">{` ${fmt("compact", n.value)}`}</tspan>
                      </tspan>
                    </text>
                  ) : (
                    <text x={n.x + n.w / 2} y={n.y - 8} textAnchor="middle" className="fill-[var(--ink-1)] text-[12px] font-bold">
                      {`Income ${fmt("money0", n.value)}`}
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
