"use client";

// src/components/spending-donut.tsx
//
// The category donut and its legend list, sharing one highlight: hover a row
// and its slice lifts; hover a slice and its row lights. ≤ 6 slices plus
// "Other", per the part-to-whole rule — anything smaller folds.

import { useState } from "react";
import clsx from "clsx";
import { Donut, type Slice } from "@/components/charts/radial";
import { money0 } from "@/lib/finance/format";

export function SpendingDonut({ slices, total, label, size = 200 }: { slices: Slice[]; total: number; label: string; size?: number }) {
  const [active, setActive] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-center gap-5">
      <Donut
        slices={slices}
        size={size}
        centerLabel={label}
        centerValue={money0(total)}
        ariaLabel={`Spending by category: ${slices.map((s) => `${s.label} ${money0(s.value)}`).join(", ")}`}
        active={active}
        onActive={setActive}
      />
      <ul className="grid w-full min-w-0 grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {slices.map((s) => (
          <li
            key={s.id}
            onPointerEnter={() => setActive(s.id)}
            onPointerLeave={() => setActive(null)}
            className={clsx(
              "flex items-center gap-2 rounded-ctl px-2 py-1.5 text-[13px] transition-colors duration-150",
              active === s.id ? "bg-surface-3" : "",
              active && active !== s.id ? "opacity-60" : "",
            )}
          >
            <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate font-medium text-ink-1">{s.label}</span>
            <span className="num text-xs text-ink-3">{total > 0 ? Math.round((s.value / total) * 100) : 0}%</span>
            <span className="num text-right font-semibold text-ink-1">{money0(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
