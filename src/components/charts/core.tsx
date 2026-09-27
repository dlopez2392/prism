"use client";

// apps/finance/src/components/charts/core.tsx
//
// Shared chart plumbing: measuring, value formats, the tooltip and the legend.
// Values cross the server→client boundary as data, so formats travel as
// names ("money0") rather than functions.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { money, money0, moneyCompact, percent } from "@/lib/finance/format";

export type ValueFormat = "money" | "money0" | "compact" | "percent" | "score" | "count";

export function fmt(kind: ValueFormat, v: number): string {
  switch (kind) {
    case "money":
      return money(v);
    case "money0":
      return money0(v);
    case "compact":
      return moneyCompact(v);
    case "percent":
      return percent(v);
    case "score":
    case "count":
      return Math.round(v).toLocaleString("en-US");
  }
}

/**
 * The element's content width, tracked with a ResizeObserver. 0 until the
 * first measurement — charts render a same-height placeholder until then, so
 * text is always drawn at real pixel size instead of being scaled by a viewBox.
 */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export type TooltipRow = {
  color?: string;
  /** "line" keys a line series; "dot" a bar/segment/cell. */
  key?: "line" | "dot" | "dash";
  label: string;
  value: string;
};

/**
 * One tooltip for every chart. Values lead (strong ink), labels follow
 * (secondary ink); series identity rides on a short stroke of the series
 * colour, never on coloured text.
 */
export function ChartTooltip({
  x,
  y,
  width,
  title,
  rows,
  footer,
}: {
  x: number;
  y: number;
  /** Container width, used to flip the tooltip left near the right edge. */
  width: number;
  title: string;
  rows: TooltipRow[];
  footer?: string;
}) {
  const flip = x > width * 0.6;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-20 min-w-40 max-w-64 rounded-ctl border border-line bg-surface-1 px-3 py-2.5 text-xs shadow-pop"
      style={{
        left: flip ? undefined : Math.min(x + 14, Math.max(0, width - 168)),
        right: flip ? Math.max(0, width - x + 14) : undefined,
        top: Math.max(0, y),
      }}
    >
      <div className="mb-1.5 font-medium text-ink-3">{title}</div>
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2">
            {r.color ? <Key color={r.color} kind={r.key ?? "line"} /> : null}
            <span className="num font-semibold text-ink-1">{r.value}</span>
            <span className="truncate text-ink-2">{r.label}</span>
          </li>
        ))}
      </ul>
      {footer ? <div className="mt-1.5 border-t border-line pt-1.5 text-ink-3">{footer}</div> : null}
    </div>
  );
}

export function Key({ color, kind }: { color: string; kind: "line" | "dot" | "dash" | "rect" }) {
  if (kind === "dot") return <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />;
  if (kind === "rect") return <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />;
  return (
    <svg aria-hidden width="14" height="4" className="shrink-0" viewBox="0 0 14 4">
      <line
        x1="1"
        y1="2"
        x2="13"
        y2="2"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={kind === "dash" ? "3 3" : undefined}
      />
    </svg>
  );
}

export type LegendItem = { label: string; color: string; kind?: "line" | "rect" | "dash" | "dot"; value?: string };

/** Legends mirror the mark: a rect for bars and areas, a line for lines. */
export function Legend({ items, className = "" }: { items: LegendItem[]; className?: string }) {
  return (
    <ul className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-2 ${className}`}>
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <Key color={it.color} kind={it.kind ?? "rect"} />
          <span>{it.label}</span>
          {it.value ? <span className="num font-semibold text-ink-1">{it.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** A same-height stand-in while a chart measures its container. */
export function ChartPlaceholder({ height }: { height: number }) {
  return <div className="skeleton w-full" style={{ height }} aria-hidden />;
}

export function SrOnly({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
