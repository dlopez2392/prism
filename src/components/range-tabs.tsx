// src/components/range-tabs.tsx
//
// The one filter row above a screen's charts: a date range, as links, so the
// choice is in the URL and every chart below re-renders against the same slice.

import Link from "next/link";
import clsx from "clsx";
import { RANGES, type RangeMonths } from "@/lib/finance/view";

const LABEL: Record<RangeMonths, string> = { 3: "3 months", 6: "6 months", 12: "12 months" };

export function RangeTabs({ path, active }: { path: string; active: RangeMonths }) {
  return (
    <nav aria-label="Date range" className="inline-flex rounded-ctl border border-line bg-surface-1 p-1 shadow-card">
      {RANGES.map((r) => (
        <Link
          key={r}
          href={`${path}?range=${r}`}
          scroll={false}
          aria-current={r === active ? "true" : undefined}
          className={clsx(
            "rounded-[calc(var(--radius-ctl)-4px)] px-3 py-1.5 text-xs font-bold transition-colors duration-150",
            r === active ? "bg-button text-ink-on-accent" : "text-ink-2 hover:bg-surface-3 hover:text-ink-1",
          )}
        >
          {LABEL[r]}
        </Link>
      ))}
    </nav>
  );
}
