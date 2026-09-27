// apps/finance/src/lib/finance/view.ts
//
// Small presentational decisions shared by screens, kept out of components so
// they can be tested: how categories fold for a donut, how a greeting reads.

import type { CategoryRow } from "./cashflow";
import { CATEGORIES, categoryColor } from "./categories";
import { addDays, addMonths, daysBetween, eachDay, lastMonths, startOfMonth } from "./dates";
import type { Cents, ISODate, Transaction } from "./types";

export type SliceData = { id: string; label: string; value: Cents; color: string };

/**
 * Part-to-whole at a glance works up to about six slices. Keep the largest
 * `max` named categories; everything else (including "Other" itself) folds
 * into one neutral "Everything else" slice.
 */
export function foldSlices(rows: CategoryRow[], max = 6): SliceData[] {
  const named = rows.filter((r) => r.category !== "other").slice(0, max);
  const keep = new Set(named.map((r) => r.category));
  const rest = rows.filter((r) => !keep.has(r.category)).reduce((s, r) => s + r.amount, 0);
  const slices: SliceData[] = named.map((r) => ({ id: r.category, label: CATEGORIES[r.category].label, value: r.amount, color: categoryColor(r.category) }));
  if (rest > 0) slices.push({ id: "rest", label: "Everything else", value: rest, color: "var(--c-other)" });
  return slices;
}

export function greeting(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}


export const RANGES = [3, 6, 12] as const;
export type RangeMonths = (typeof RANGES)[number];

export function parseRange(raw: string | string[] | undefined, fallback: RangeMonths = 6): RangeMonths {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return (RANGES as readonly number[]).includes(n) ? (n as RangeMonths) : fallback;
}

/**
 * A window of `months` calendar months ending today (the current month counts
 * as one, so far), plus the equally long window just before it.
 */
export function monthWindow(today: ISODate, months: number) {
  const from = addMonths(startOfMonth(today), -(months - 1));
  const span = daysBetween(from, today);
  const prevTo = addDays(from, -1);
  return { from, to: today, prevFrom: addDays(prevTo, -span), prevTo, months: lastMonths(today, months) };
}

/** End-of-day balances for one account, walked backwards from its current balance. */
export function dailyBalances(txns: Transaction[], accountId: string, balance: number, from: ISODate, to: ISODate) {
  const flows = new Map<ISODate, number>();
  for (const t of txns) if (t.accountId === accountId && t.date > from && t.date <= to) flows.set(t.date, (flows.get(t.date) ?? 0) + t.amount);
  const days = eachDay(from, to);
  const out = new Array<{ date: ISODate; balance: number }>(days.length);
  let running = balance;
  for (let i = days.length - 1; i >= 0; i--) {
    out[i] = { date: days[i]!, balance: running };
    running -= flows.get(days[i]!) ?? 0;
  }
  return out;
}
