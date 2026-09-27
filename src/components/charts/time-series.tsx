"use client";

// apps/finance/src/components/charts/time-series.tsx
//
// Lines and areas over time, with a crosshair that finds the X: readers aim
// at a date, never at a 2px line. Supports a projection (dashed from an
// index on — the future is dashed, the past is solid), a forecast band,
// event markers (paydays, bills) and a "today" rule.

import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { areaPath, bandPath, linear, linePath, niceTicks, thinIndices, type Curve, type Pt } from "@/lib/charts/geometry";
import { ChartPlaceholder, ChartTooltip, fmt, useWidth, type TooltipRow, type ValueFormat } from "./core";

export type TimeSeries = {
  id: string;
  label: string;
  color: string;
  values: (number | null)[];
  /** A ~12% wash under the line. */
  area?: boolean;
  /** Index from which the line is a projection (dashed). */
  dashFrom?: number;
  /** Draw this series thinner and quieter (context, not the story). */
  muted?: boolean;
};

export type Marker = { index: number; label: string; value: string; direction: "in" | "out" };

type Props = {
  labels: string[];
  axisLabels?: string[];
  series: TimeSeries[];
  band?: { low: number[]; high: number[]; label: string; color: string };
  markers?: Marker[];
  todayIndex?: number;
  height?: number;
  format?: ValueFormat;
  axisFormat?: ValueFormat;
  /** Force the y-domain to include this value (e.g. 0). */
  include?: number;
  maxAxisLabels?: number;
  ariaLabel: string;
  /** Label the last point of each series directly. */
  endLabels?: boolean;
  curve?: Curve;
};

const M = { top: 14, right: 14, bottom: 26, left: 52 };

export function TimeSeriesChart({
  labels,
  axisLabels = labels,
  series,
  band,
  markers = [],
  todayIndex,
  height = 240,
  format = "money0",
  axisFormat = "compact",
  include,
  maxAxisLabels = 7,
  ariaLabel,
  endLabels = false,
  curve = "smooth",
}: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, "");
  const n = labels.length;

  const geo = useMemo(() => {
    if (width === 0 || n === 0) return null;
    const all: number[] = [];
    for (const s of series) for (const v of s.values) if (v !== null) all.push(v);
    if (band) all.push(...band.low, ...band.high);
    if (include !== undefined) all.push(include);
    const ticks = niceTicks(Math.min(...all), Math.max(...all), 4);
    const right = endLabels ? 64 : M.right;
    const x = linear([0, Math.max(1, n - 1)], [M.left, width - right]);
    const y = linear([ticks[0]!, ticks.at(-1)!], [height - M.bottom, M.top]);
    const pts = (vals: (number | null)[]) =>
      vals.map((v, i) => (v === null ? null : ([x(i), y(v)] as Pt))).filter((p): p is Pt => p !== null);
    return { ticks, x, y, pts, right };
  }, [width, n, series, band, include, height, endLabels]);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!geo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const step = (width - geo.right - M.left) / Math.max(1, n - 1);
    setHover(Math.max(0, Math.min(n - 1, Math.round((px - M.left) / step))));
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
    else if (e.key === "Home") setHover(0);
    else if (e.key === "End") setHover(n - 1);
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  };

  const tip = useMemo(() => {
    if (hover === null || !geo) return null;
    const rows: TooltipRow[] = [];
    for (const s of series) {
      const v = s.values[hover];
      if (v === null || v === undefined) continue;
      const projected = s.dashFrom !== undefined && hover > s.dashFrom;
      rows.push({ color: s.color, key: projected ? "dash" : "line", label: projected ? `${s.label} (projected)` : s.label, value: fmt(format, v) });
    }
    if (band && band.low[hover] !== band.high[hover]) {
      rows.push({ label: band.label, value: `${fmt(format, band.low[hover]!)} – ${fmt(format, band.high[hover]!)}` });
    }
    const here = markers.filter((m) => m.index === hover);
    return { rows, footer: here.length ? here.map((m) => `${m.label} ${m.value}`).join(" · ") : undefined };
  }, [hover, geo, series, band, markers, format]);

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
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
          >
            <defs>
              {series
                .filter((s) => s.area)
                .map((s) => (
                  <linearGradient key={s.id} id={`${gid}-${s.id}`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.26} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                  </linearGradient>
                ))}
            </defs>

            {/* Grid and y ticks */}
            {geo.ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={width - geo.right} y1={geo.y(t)} y2={geo.y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
                <text x={M.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" className="num fill-[var(--ink-3)] text-[11px]">
                  {fmt(axisFormat, t)}
                </text>
              </g>
            ))}

            {/* X labels — every period gets one, thinned by parity when tight. */}
            {thinIndices(n, Math.max(2, Math.min(maxAxisLabels, Math.floor((width - M.left) / 56)))).map((i) => (
              <text key={i} x={geo.x(i)} y={height - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-[var(--ink-3)] text-[11px]">
                {axisLabels[i]}
              </text>
            ))}

            {todayIndex !== undefined ? (
              <g>
                <line x1={geo.x(todayIndex)} x2={geo.x(todayIndex)} y1={M.top} y2={height - M.bottom} stroke="var(--line-strong)" strokeWidth={1} />
                <text x={geo.x(todayIndex) + 4} y={M.top + 8} className="fill-[var(--ink-3)] text-[10px] font-semibold uppercase tracking-wider">
                  Today
                </text>
              </g>
            ) : null}

            {band ? (
              <path
                d={bandPath(
                  band.high.map((v, i) => [geo.x(i), geo.y(v)] as Pt),
                  band.low.map((v, i) => [geo.x(i), geo.y(v)] as Pt),
                  curve,
                )}
                fill={band.color}
                opacity={0.14}
              />
            ) : null}

            {series.map((s) => {
              const pts = geo.pts(s.values);
              if (pts.length < 2) return null;
              const split = s.dashFrom !== undefined ? Math.min(s.dashFrom, pts.length - 1) : pts.length - 1;
              return (
                <g key={s.id} opacity={hover !== null && s.muted ? 0.5 : 1}>
                  {s.area ? <path d={areaPath(pts, geo.y(geo.ticks[0]!), curve)} fill={`url(#${gid}-${s.id})`} /> : null}
                  <path
                    d={linePath(pts, 0, split, curve)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={s.muted ? 1.5 : 2.25}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pathLength={1}
                    className="chart-draw"
                  />
                  {split < pts.length - 1 ? (
                    <path
                      d={linePath(pts, split, pts.length - 1, curve)}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      strokeLinecap="round"
                    />
                  ) : null}
                </g>
              );
            })}

            {/* End labels and end dots — label the endpoint, not every point. */}
            {series.map((s) => {
              const pts = geo.pts(s.values);
              const last = pts.at(-1);
              const v = [...s.values].reverse().find((x) => x !== null);
              if (!last || s.muted || v === undefined || v === null) return null;
              return (
                <g key={`${s.id}-end`}>
                  <circle cx={last[0]} cy={last[1]} r={4.5} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
                  {endLabels ? (
                    <text x={last[0] + 9} y={last[1]} dy="0.32em" className="num fill-[var(--ink-1)] text-[11px] font-semibold">
                      {fmt("compact", v)}
                    </text>
                  ) : null}
                </g>
              );
            })}

            {markers.map((m, i) => {
              // Sit on whichever series has a value there (actual or forecast).
              const v = series.map((s) => s.values[m.index]).find((x) => x !== null && x !== undefined);
              if (v === null || v === undefined) return null;
              return (
                <circle
                  key={i}
                  cx={geo.x(m.index)}
                  cy={geo.y(v)}
                  r={3.5}
                  fill={m.direction === "in" ? "var(--flow-in)" : "var(--flow-out)"}
                  stroke="var(--surface-1)"
                  strokeWidth={1.5}
                />
              );
            })}

            {hover !== null ? (
              <g pointerEvents="none">
                <line x1={geo.x(hover)} x2={geo.x(hover)} y1={M.top} y2={height - M.bottom} stroke="var(--crosshair)" strokeWidth={1} />
                {series.map((s) => {
                  const v = s.values[hover];
                  if (v === null || v === undefined) return null;
                  return <circle key={s.id} cx={geo.x(hover)} cy={geo.y(v)} r={5} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />;
                })}
              </g>
            ) : null}
          </svg>
          {hover !== null && tip && tip.rows.length ? (
            <ChartTooltip x={geo.x(hover)} y={M.top} width={width} title={labels[hover]!} rows={tip.rows} footer={tip.footer} />
          ) : null}
        </>
      )}
    </div>
  );
}
