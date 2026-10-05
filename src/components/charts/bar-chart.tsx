"use client";

// src/components/charts/bar-chart.tsx
//
// Columns over time — grouped (income vs spending) or stacked (spending by
// category). Bars are capped at 24px and never fill their slot; each has a
// 4px rounded data-end and a square foot; touching fills are separated by a
// 2px gap, not a stroke. The whole column is the hover target, and the
// tooltip lists every series in it. A column can also be a door (`hrefs`):
// a click opens it, Enter does from the keyboard, and on a touch screen the
// first tap shows the tooltip and a second opens it, so a tap never leaves
// the page before its numbers have been read.

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { barPath, linear, niceTicks, rectPath, thinIndices } from "@/lib/charts/geometry";
import { ChartPlaceholder, ChartTooltip, fmt, useWidth, type TooltipRow, type ValueFormat } from "./core";

export type BarSeries = {
  id: string;
  label: string;
  color: string;
  values: number[];
  /** Colour for negative values (diverging net bars). */
  negativeColor?: string;
};

type Props = {
  labels: string[];
  axisLabels?: string[];
  series: BarSeries[];
  mode?: "grouped" | "stacked";
  height?: number;
  format?: ValueFormat;
  axisFormat?: ValueFormat;
  /** Indices drawn at reduced strength — e.g. the month still in progress. */
  partial?: number[];
  partialNote?: string;
  maxBar?: number;
  ariaLabel: string;
  /** Show the value above each column's data end (only sensible for few bars). */
  valueLabels?: boolean;
  /** Where each column leads (null: nowhere), and what its tooltip says it opens: "See the month". */
  hrefs?: (string | null)[];
  hrefNote?: string;
};

const M = { top: 16, right: 8, bottom: 26, left: 52 };
const GAP = 2;

export function BarChart({
  labels,
  axisLabels = labels,
  series,
  mode = "grouped",
  height = 240,
  format = "money0",
  axisFormat = "compact",
  partial = [],
  partialNote = "so far",
  maxBar = 24,
  ariaLabel,
  valueLabels = false,
  hrefs,
  hrefNote = "Select to open",
}: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const router = useRouter();
  // The column a tap may open: a mouse opens at once; a touch only once its tooltip is already showing.
  const shown = useRef<number | null>(null);
  const armed = useRef<number | null>(null);
  const n = labels.length;
  const show = (i: number | null) => {
    shown.current = i;
    setHover(i);
  };
  const press = (i: number, e: PointerEvent<SVGGElement>) => {
    armed.current = e.pointerType !== "touch" || shown.current === i ? i : null;
    show(i);
  };
  const open = (i: number) => {
    const href = hrefs?.[i];
    if (href && armed.current === i) router.push(href, { scroll: false });
  };

  const geo = useMemo(() => {
    if (width === 0 || n === 0) return null;
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < n; i++) {
      if (mode === "stacked") {
        const pos = series.reduce((s, x) => s + Math.max(0, x.values[i] ?? 0), 0);
        const neg = series.reduce((s, x) => s + Math.min(0, x.values[i] ?? 0), 0);
        hi = Math.max(hi, pos);
        lo = Math.min(lo, neg);
      } else {
        for (const s of series) {
          hi = Math.max(hi, s.values[i] ?? 0);
          lo = Math.min(lo, s.values[i] ?? 0);
        }
      }
    }
    const ticks = niceTicks(lo, hi, 4);
    const y = linear([ticks[0]!, ticks.at(-1)!], [height - M.bottom, M.top]);
    const slot = (width - M.left - M.right) / n;
    const groups = mode === "grouped" ? series.length : 1;
    const bar = Math.max(3, Math.min(maxBar, (slot * 0.72 - GAP * (groups - 1)) / groups));
    const groupW = bar * groups + GAP * (groups - 1);
    const x0 = (i: number) => M.left + slot * i + (slot - groupW) / 2;
    return { ticks, y, slot, bar, x0 };
  }, [width, n, series, mode, height, maxBar]);

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight") show(Math.min(n - 1, (hover ?? -1) + 1));
    else if (e.key === "ArrowLeft") show(Math.max(0, (hover ?? n) - 1));
    else if (e.key === "Escape") show(null);
    else if (e.key === "Enter" && hover !== null && hrefs?.[hover]) router.push(hrefs[hover]!, { scroll: false });
    else return;
    e.preventDefault();
  };

  const tip = useMemo(() => {
    if (hover === null) return null;
    const rows: TooltipRow[] = series
      .filter((s) => (s.values[hover] ?? 0) !== 0 || mode === "grouped")
      .map((s) => {
        const v = s.values[hover] ?? 0;
        return { color: v < 0 && s.negativeColor ? s.negativeColor : s.color, key: "dot" as const, label: s.label, value: fmt(format, v) };
      });
    if (mode === "stacked") rows.reverse();
    const total = mode === "stacked" && series.length > 1 ? series.reduce((s, x) => s + (x.values[hover] ?? 0), 0) : null;
    const footer = [total !== null ? `Total ${fmt(format, total)}` : null, partial.includes(hover) ? partialNote : null, hrefs?.[hover] ? hrefNote : null]
      .filter(Boolean)
      .join(" · ");
    return { rows, footer: footer || undefined };
  }, [hover, series, mode, format, partial, partialNote, hrefs, hrefNote]);

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {!geo ? (
        <ChartPlaceholder height={height} />
      ) : (
        <>
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={ariaLabel}
            tabIndex={0}
            className="block touch-pan-y outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
            // A finger "leaves" the moment it lifts: on a touch screen the tooltip stays until the chart loses focus.
            onPointerLeave={(e) => {
              if (e.pointerType !== "touch") show(null);
            }}
            onKeyDown={onKey}
            onBlur={() => show(null)}
          >
            {geo.ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={width - M.right} y1={geo.y(t)} y2={geo.y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
                <text x={M.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" className="num fill-[var(--ink-3)] text-[11px]">
                  {fmt(axisFormat, t)}
                </text>
              </g>
            ))}

            {thinIndices(n, Math.max(2, Math.floor((width - M.left) / 40))).map((i) => (
              <text key={i} x={M.left + geo.slot * (i + 0.5)} y={height - 6} textAnchor="middle" className="fill-[var(--ink-3)] text-[11px]">
                {axisLabels[i]}
              </text>
            ))}

            {labels.map((_, i) => {
              const dim = hover !== null && hover !== i;
              const faint = partial.includes(i);
              const zero = geo.y(0);
              const marks: { d: string; fill: string }[] = [];
              if (mode === "grouped") {
                series.forEach((s, k) => {
                  const v = s.values[i] ?? 0;
                  const x = geo.x0(i) + k * (geo.bar + GAP);
                  marks.push({ d: barPath(x, zero, geo.y(v), geo.bar), fill: v < 0 && s.negativeColor ? s.negativeColor : s.color });
                });
              } else {
                let up = zero;
                let down = zero;
                const pos = series.filter((s) => (s.values[i] ?? 0) > 0);
                pos.forEach((s, k) => {
                  const h = zero - geo.y(s.values[i]!);
                  const top = up - h;
                  const isEnd = k === pos.length - 1;
                  const gap = k > 0 ? GAP : 0;
                  marks.push({
                    d: isEnd ? barPath(geo.x0(i), up - gap, top, geo.bar) : rectPath(geo.x0(i), top, geo.bar, h - gap),
                    fill: s.color,
                  });
                  up = top;
                });
                for (const s of series.filter((x) => (x.values[i] ?? 0) < 0)) {
                  const h = geo.y(s.values[i]!) - zero;
                  marks.push({ d: barPath(geo.x0(i), down, down + h, geo.bar), fill: s.negativeColor ?? s.color });
                  down += h;
                }
              }
              const total = series.reduce((s, x) => s + (x.values[i] ?? 0), 0);
              const topY = mode === "stacked" ? geo.y(Math.max(0, total)) : Math.min(...series.map((s) => geo.y(Math.max(0, s.values[i] ?? 0))));
              return (
                <g
                  key={i}
                  className={hrefs?.[i] ? "mark cursor-pointer" : "mark"}
                  opacity={dim ? 0.45 : faint ? 0.6 : 1}
                  onPointerEnter={(e) => {
                    if (e.pointerType !== "touch") show(i);
                  }}
                  onPointerDown={(e) => press(i, e)}
                  onClick={() => open(i)}
                >
                  {/* The whole column is the hit target, bigger than the mark. */}
                  <rect x={M.left + geo.slot * i} y={M.top} width={geo.slot} height={height - M.top - M.bottom} fill="transparent" />
                  {marks.map((m, k) => (m.d ? <path key={k} d={m.d} fill={m.fill} className="chart-grow" style={{ animationDelay: `${i * 25}ms` }} /> : null))}
                  {valueLabels ? (
                    <text x={M.left + geo.slot * (i + 0.5)} y={topY - 6} textAnchor="middle" className="num fill-[var(--ink-2)] text-[11px] font-semibold">
                      {fmt("compact", total)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {hover !== null && tip ? (
            <ChartTooltip x={M.left + geo.slot * (hover + 0.5)} y={M.top} width={width} title={labels[hover]!} rows={tip.rows} footer={tip.footer} />
          ) : null}
        </>
      )}
    </div>
  );
}
