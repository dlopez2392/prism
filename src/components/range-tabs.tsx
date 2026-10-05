// src/components/range-tabs.tsx
//
// The one filter row above a screen's charts: a date range, as links, so the
// choice is in the URL and every chart below re-renders against the same slice.

import Link from "next/link";
import clsx from "clsx";
import { RANGES, type RangeMonths } from "@/lib/finance/view";

const LABEL: Record<RangeMonths, string> = { 1: "1 month", 3: "3 months", 6: "6 months", 12: "12 months" };

export function RangeTabs({ path, active }: { path: string; active: RangeMonths }) {
  return (
    // Full width on a phone, where four ranges share the row evenly; its own width from sm up.
    <nav aria-label="Date range" className="flex w-full rounded-ctl border border-line bg-surface-1 p-1 shadow-card sm:inline-flex sm:w-auto">
      {RANGES.map((r) => (
        <Link
          key={r}
          href={`${path}?range=${r}`}
          scroll={false}
          aria-current={r === active ? "true" : undefined}
          className={clsx(
            "flex-1 whitespace-nowrap rounded-[calc(var(--radius-ctl)-4px)] px-2 py-1.5 text-center text-xs font-bold transition-colors duration-150 sm:flex-none sm:px-3",
            r === active ? "bg-button text-ink-on-accent" : "text-ink-2 hover:bg-surface-3 hover:text-ink-1",
          )}
        >
          {LABEL[r]}
        </Link>
      ))}
    </nav>
  );
}
