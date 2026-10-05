// src/components/range-tabs.tsx
//
// The one filter row above a screen's charts: a date range, as links, so the
// choice is in the URL and every chart below re-renders against the same slice.
// With one month chosen, a stepper beside it walks back through past months.

import Link from "next/link";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthLong } from "@/lib/finance/format";
import { RANGES, type RangeMonths } from "@/lib/finance/view";

const LABEL: Record<RangeMonths, string> = { 1: "1 month", 3: "3 months", 6: "6 months", 12: "12 months" };

/** The month a one-month view shows ("2026-09"), and the months either side it can step to ("current" is this month), from monthSteps. */
export type MonthStep = { shown: string; older: string | null; newer: string | null };

const named = (key: string) => `${monthLong(`${key}-01`)} ${key.slice(0, 4)}`;

export function RangeTabs({ path, active, step }: { path: string; active: RangeMonths; step?: MonthStep }) {
  const monthHref = (key: string) => (key === "current" ? `${path}?range=1` : `${path}?range=1&month=${key}`);
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
      {/* Full width on a phone, where four ranges share the row evenly; its own width from sm up. */}
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
      {step ? (
        <nav aria-label="Month" className="flex items-center justify-between rounded-ctl border border-line bg-surface-1 p-1 shadow-card">
          <StepLink href={step.older && monthHref(step.older)} label={step.older && `Earlier month, ${named(step.older)}`} icon={ChevronLeft} />
          <span className="num min-w-[8.5rem] whitespace-nowrap px-2 text-center text-xs font-bold text-ink-1">{named(step.shown)}</span>
          <StepLink
            href={step.newer && monthHref(step.newer)}
            label={step.newer && `Later month, ${step.newer === "current" ? "this month" : named(step.newer)}`}
            icon={ChevronRight}
          />
        </nav>
      ) : null}
    </div>
  );
}

const STEP = "grid size-8 place-items-center rounded-[calc(var(--radius-ctl)-4px)] sm:size-7";

/** One arrow: a link to the month it names, or, with nothing to step to, the arrow dimmed and out of the tab order. */
function StepLink({ href, label, icon: Icon }: { href: string | null; label: string | null; icon: typeof ChevronLeft }) {
  if (!href || !label) {
    return (
      <span aria-hidden className={clsx(STEP, "text-ink-3 opacity-40")}>
        <Icon className="size-4" strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <Link href={href} scroll={false} aria-label={label} className={clsx(STEP, "text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink-1")}>
      <Icon aria-hidden className="size-4" strokeWidth={2.5} />
    </Link>
  );
}
