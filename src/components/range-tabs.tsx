// src/components/range-tabs.tsx
//
// The one filter row above a screen's charts: a date range, as links, so the
// choice is in the URL and every chart below re-renders against the same slice.
// With one month chosen, a stepper beside it walks back through past months.

import Link from "next/link";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { capitalized, monthLong } from "@/lib/finance/format";
import { RANGES, type RangeMonths } from "@/lib/finance/view";
import { EN, msg, type T } from "@/lib/i18n/t";

const LABEL: Record<RangeMonths, string> = { 1: msg("1 month"), 3: msg("3 months"), 6: msg("6 months"), 12: msg("12 months") };

/** The month a one-month view shows ("2026-09"), and the months either side it can step to ("current" is this month), from monthSteps. */
export type MonthStep = { shown: string; older: string | null; newer: string | null };

export function RangeTabs({ path, active, step, t = EN }: { path: string; active: RangeMonths; step?: MonthStep; t?: T }) {
  const named = (key: string) => t("{month} {year}", { month: monthLong(`${key}-01`, t.locale), year: key.slice(0, 4) });
  const monthHref = (key: string) => (key === "current" ? `${path}?range=1` : `${path}?range=1&month=${key}`);
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
      {/* Full width on a phone, where four ranges share the row evenly; its own width from sm up. */}
      <nav aria-label={t("Date range")} className="flex w-full rounded-ctl border border-line bg-surface-1 p-1 shadow-card sm:inline-flex sm:w-auto">
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
            {t(LABEL[r])}
          </Link>
        ))}
      </nav>
      {step ? (
        <nav aria-label={t("Month")} className="flex items-center justify-between rounded-ctl border border-line bg-surface-1 p-1 shadow-card">
          <StepLink href={step.older && monthHref(step.older)} label={step.older && t("Earlier month, {month}", { month: named(step.older) })} icon={ChevronLeft} />
          <span className="num min-w-[8.5rem] whitespace-nowrap px-2 text-center text-xs font-bold text-ink-1">{capitalized(named(step.shown))}</span>
          <StepLink
            href={step.newer && monthHref(step.newer)}
            label={step.newer && (step.newer === "current" ? t("Later month, this month") : t("Later month, {month}", { month: named(step.newer) }))}
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
