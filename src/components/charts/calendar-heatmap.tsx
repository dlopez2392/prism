"use client";

// src/components/charts/calendar-heatmap.tsx
//
// Daily spending as a calendar — weeks across, weekdays down. Magnitude job,
// so ONE hue light→dark (the --seq ramp, which flips in dark mode), binned by
// quantile so one rent day cannot wash every coffee day out to the lightest
// step. Empty days are the ramp's zero step, not a hole.

import { useMemo, useState } from "react";
import { binOf, quantileThresholds } from "@/lib/charts/geometry";
import { dayOfWeek } from "@/lib/finance/dates";
import { dayDate, money, monthShort } from "@/lib/finance/format";
import { ChartPlaceholder, ChartTooltip, useWidth } from "./core";

const BINS = 5;
const MIN_CELL = 12;
const LEFT = 30;
const TOP = 18;

export function CalendarHeatmap({ days, ariaLabel }: { days: { date: string; amount: number }[]; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const all = useMemo(() => {
    if (days.length === 0) return null;
    const lead = dayOfWeek(days[0]!.date);
    const cells = days.map((d, i) => {
      const idx = i + lead;
      return { ...d, col: Math.floor(idx / 7), row: idx % 7 };
    });
    // Bins come from every day passed in, so a cell's shade does not change
    // when a narrower screen shows fewer weeks.
    return { cells, weeks: cells.at(-1)!.col + 1, thresholds: quantileThresholds(days.map((d) => d.amount), BINS) };
  }, [days]);

  // Show as many recent weeks as fit at a legible size (≥ 12px cells), up to
  // everything passed in — a year on a desktop, about four months on a phone.
  const grid = useMemo(() => {
    if (!all || !width) return null;
    const fit = Math.floor((width - LEFT) / (MIN_CELL + 3));
    const weeks = Math.max(1, Math.min(all.weeks, fit));
    const offset = all.weeks - weeks;
    const cells = all.cells.filter((c) => c.col >= offset).map((c) => ({ ...c, col: c.col - offset }));
    return { cells, weeks, thresholds: all.thresholds };
  }, [all, width]);

  const size = grid ? Math.max(MIN_CELL, Math.min(20, Math.floor((width - LEFT) / grid.weeks) - 3)) : 0;
  const step = size + 3;
  const height = TOP + 7 * step + 4;
  const monthLabels = grid
    ? grid.cells.filter((c, i) => (c.date.endsWith("-01") && c.col > 0) || i === 0).filter((c, i, arr) => i === arr.length - 1 || arr[i + 1]!.col - c.col >= 3)
    : [];

  return (
    <div>
      <div ref={ref} className="relative w-full" style={{ height: height || 150 }}>
        {!grid ? (
          <ChartPlaceholder height={150} />
        ) : (
          <>
            <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block" onPointerLeave={() => setHover(null)}>
              {["Mon", "Wed", "Fri"].map((d, i) => (
                <text key={d} x={0} y={TOP + (1 + i * 2) * step + size / 2} dy="0.32em" className="fill-[var(--ink-3)] text-[10px]">
                  {d}
                </text>
              ))}
              {monthLabels.map((c) => (
                <text key={`m-${c.date}`} x={LEFT + c.col * step} y={10} className="fill-[var(--ink-3)] text-[10px] font-medium">
                  {monthShort(c.date)}
                </text>
              ))}
              {grid.cells.map((c, i) => {
                const bin = binOf(c.amount, grid.thresholds);
                return (
                  <rect
                    key={c.date}
                    x={LEFT + c.col * step}
                    y={TOP + c.row * step}
                    width={size}
                    height={size}
                    rx={Math.min(4, size / 4)}
                    fill={`var(--seq-${bin})`}
                    stroke={hover === i ? "var(--ink-1)" : "none"}
                    strokeWidth={1.5}
                    className="mark"
                    onPointerEnter={() => setHover(i)}
                  />
                );
              })}
            </svg>
            {hover !== null ? (
              <ChartTooltip
                x={LEFT + grid.cells[hover]!.col * step + size}
                y={TOP + grid.cells[hover]!.row * step - 8}
                width={width}
                title={dayDate(grid.cells[hover]!.date)}
                rows={[{ color: `var(--seq-${Math.max(1, binOf(grid.cells[hover]!.amount, grid.thresholds))})`, key: "dot", label: "spent", value: money(grid.cells[hover]!.amount) }]}
              />
            ) : null}
          </>
        )}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-ink-3" aria-hidden>
        <span className="mr-1">Less</span>
        {Array.from({ length: BINS + 1 }, (_, b) => (
          <span key={b} className="size-3 rounded-[3px]" style={{ background: `var(--seq-${b})` }} />
        ))}
        <span className="ml-1">More</span>
      </div>
    </div>
  );
}
