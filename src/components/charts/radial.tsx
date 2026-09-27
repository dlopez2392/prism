"use client";

// apps/finance/src/components/charts/radial.tsx
//
// The round charts: the category donut, activity-style budget rings, a single
// progress ring (budgets, goals) and the credit-score gauge. Donut slices are
// separated by a 2px surface gap (a pad angle), never a stroke.

import { useState, type ReactNode } from "react";
import { arcPath, polar, strokeArc } from "@/lib/charts/geometry";
import { fmt, type ValueFormat } from "./core";

export type Slice = { id: string; label: string; value: number; color: string };

export function Donut({
  slices,
  size = 220,
  thickness = 26,
  format = "money0",
  centerLabel,
  centerValue,
  ariaLabel,
  active,
  onActive,
}: {
  slices: Slice[];
  size?: number;
  thickness?: number;
  format?: ValueFormat;
  centerLabel: string;
  centerValue: string;
  ariaLabel: string;
  /** Controlled highlight, so a legend beside the donut can drive it. */
  active?: string | null;
  onActive?: (id: string | null) => void;
}) {
  const [own, setOwn] = useState<string | null>(null);
  const hot = active !== undefined ? active : own;
  const set = onActive ?? setOwn;
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const c = size / 2;
  const rOuter = c - 6;
  const rInner = rOuter - thickness;
  const pad = 2 / rOuter; // a 2px gap at the outer edge

  const arcs = donutArcs(slices, total, pad);
  const focus = arcs.find((s) => s.id === hot);

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={ariaLabel} className="block overflow-visible">
        {total === 0 ? <circle cx={c} cy={c} r={rOuter - thickness / 2} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} /> : null}
        {arcs.map((s) => {
          const isHot = s.id === hot;
          const lift = isHot ? 5 : 0;
          return (
            <path
              key={s.id}
              d={arcPath(c, c, rOuter + lift, rInner + (isHot ? 1 : 0), s.a0, s.a1)}
              fill={s.color}
              opacity={hot && !isHot ? 0.4 : 1}
              className="mark cursor-pointer outline-none"
              tabIndex={0}
              role="button"
              aria-label={`${s.label}: ${fmt(format, s.value)}, ${Math.round((s.value / total) * 100)}%`}
              onPointerEnter={() => set(s.id)}
              onPointerLeave={() => set(null)}
              onFocus={() => set(s.id)}
              onBlur={() => set(null)}
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="text-xs font-medium text-ink-3">{focus ? focus.label : centerLabel}</div>
        <div className="text-2xl font-bold tracking-tight text-ink-1">{focus ? fmt(format, focus.value) : centerValue}</div>
        {focus && total > 0 ? <div className="num text-xs text-ink-2">{Math.round((focus.value / total) * 100)}% of total</div> : null}
      </div>
    </div>
  );
}

/** Start/end angles per slice, clockwise from 12 o'clock, with a pad gap between. */
function donutArcs(slices: Slice[], total: number, pad: number) {
  const out: (Slice & { a0: number; a1: number })[] = [];
  let at = 0;
  for (const s of slices) {
    if (s.value <= 0) continue;
    const sweep = total > 0 ? (s.value / total) * Math.PI * 2 : 0;
    const a0 = at + pad / 2;
    out.push({ ...s, a0, a1: Math.max(a0 + 0.001, at + sweep - pad / 2) });
    at += sweep;
  }
  return out;
}

export type Ring = { id: string; label: string; ratio: number; color: string };

/**
 * Concentric rings, one per budget, outermost first — the most glanceable
 * way to show "how far through each budget am I". A ring past 100% closes
 * and the legend says "over" in words.
 */
export function ActivityRings({ rings, size = 200, stroke = 16, ariaLabel }: { rings: Ring[]; size?: number; stroke?: number; ariaLabel: string }) {
  const c = size / 2;
  const gap = 4;
  return (
    <svg width={size} height={size} role="img" aria-label={ariaLabel} className="block">
      {rings.map((r, i) => {
        const radius = c - stroke / 2 - i * (stroke + gap) - 2;
        if (radius <= stroke / 2) return null;
        const sweep = Math.min(1, Math.max(0, r.ratio)) * Math.PI * 2;
        return (
          <g key={r.id}>
            <circle cx={c} cy={c} r={radius} fill="none" stroke={r.color} strokeOpacity={0.16} strokeWidth={stroke} />
            {sweep > 0.01 ? (
              <path
                d={strokeArc(c, c, radius, 0, sweep)}
                fill="none"
                stroke={r.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                pathLength={1}
                className="chart-draw"
                style={{ animationDelay: `${i * 90}ms` }}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/** One progress ring with an optional "you are here in the month" tick. */
export function ProgressRing({
  ratio,
  color,
  size = 88,
  stroke = 10,
  tick,
  children,
  label,
}: {
  ratio: number;
  color: string;
  size?: number;
  stroke?: number;
  /** 0–1 position of a small marker on the ring (e.g. time elapsed). */
  tick?: number;
  children?: ReactNode;
  label: string;
}) {
  const c = size / 2;
  const r = c - stroke / 2 - 1;
  const sweep = Math.min(1, Math.max(0, ratio)) * Math.PI * 2;
  const tickAt = tick !== undefined ? Math.min(1, Math.max(0, tick)) * Math.PI * 2 : null;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={label} className="block">
        <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeOpacity={0.16} strokeWidth={stroke} />
        {sweep > 0.01 ? (
          <path d={strokeArc(c, c, r, 0, sweep)} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" pathLength={1} className="chart-draw" />
        ) : null}
        {tickAt !== null ? (
          <line
            x1={polar(c, c, r - stroke / 2 - 3, tickAt)[0]}
            y1={polar(c, c, r - stroke / 2 - 3, tickAt)[1]}
            x2={polar(c, c, r + stroke / 2 + 3, tickAt)[0]}
            y2={polar(c, c, r + stroke / 2 + 3, tickAt)[1]}
            stroke="var(--ink-1)"
            strokeWidth={2}
            strokeLinecap="round"
          />
        ) : null}
      </svg>
      {children ? <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div> : null}
    </div>
  );
}

const SCORE_BANDS: { from: number; to: number; color: string }[] = [
  { from: 300, to: 579, color: "var(--crit)" },
  { from: 580, to: 669, color: "var(--serious)" },
  { from: 670, to: 739, color: "var(--warn)" },
  { from: 740, to: 850, color: "var(--good)" },
];

export function scoreBand(score: number): { label: string; color: string } {
  if (score >= 800) return { label: "Exceptional", color: "var(--good)" };
  if (score >= 740) return { label: "Very good", color: "var(--good)" };
  if (score >= 670) return { label: "Good", color: "var(--warn)" };
  if (score >= 580) return { label: "Fair", color: "var(--serious)" };
  return { label: "Needs work", color: "var(--crit)" };
}

/** A semicircular 300–850 gauge. Band colours carry status; the word says it too. */
export function ScoreGauge({ score, size = 240 }: { score: number; size?: number }) {
  const c = size / 2;
  const r = c - 14;
  const h = c + 18;
  const toA = (v: number) => -Math.PI / 2 + ((v - 300) / 550) * Math.PI;
  const [mx, my] = polar(c, c, r, toA(score));
  const band = scoreBand(score);
  return (
    <div className="relative mx-auto" style={{ width: size, height: h }}>
      <svg width={size} height={h} role="img" aria-label={`Credit score ${score}, ${band.label}`} className="block">
        {SCORE_BANDS.map((b) => (
          <path
            key={b.from}
            d={strokeArc(c, c, r, toA(b.from) + 0.02, toA(b.to) - 0.02)}
            fill="none"
            stroke={b.color}
            strokeWidth={10}
            strokeLinecap="round"
            opacity={score >= b.from ? 1 : 0.3}
          />
        ))}
        <circle cx={mx} cy={my} r={9} fill="var(--surface-1)" stroke="var(--ink-1)" strokeWidth={3} />
      </svg>
      <div className="absolute inset-x-0 bottom-1 text-center">
        <div className="text-4xl font-bold tracking-tight text-ink-1">{score}</div>
        <div className="text-xs font-medium text-ink-2">{band.label} · 300–850</div>
      </div>
    </div>
  );
}
