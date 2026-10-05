// src/lib/finance/view.ts
//
// Small presentational decisions shared by screens, kept out of components so
// they can be tested: how categories fold for a donut, how a greeting reads.

import type { CategoryRow } from "./cashflow";
import { CATEGORIES, categoryColor } from "./categories";
import { addMonths, eachDay, endOfMonth, lastMonths, monthKey, startOfMonth } from "./dates";
import { dayRange, monthLong, monthYear } from "./format";
import type { CategoryId, Cents, ISODate, Transaction } from "./types";

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


export const RANGES = [1, 3, 6, 12] as const;
export type RangeMonths = (typeof RANGES)[number];

export function parseRange(raw: string | string[] | undefined, fallback: RangeMonths = 6): RangeMonths {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return (RANGES as readonly number[]).includes(n) ? (n as RangeMonths) : fallback;
}

/**
 * A window of `months` calendar months ending on `end` (today, with the
 * current month counted as one, so far; or the last day of a past month),
 * and the window it's compared with: the same days, `months` months earlier.
 * Aligned by the calendar, not by length, so both hold the same paydays and
 * the same rent: on Oct 5 the last 3 months (Aug 1 – Oct 5) are set against
 * May 1 – Jul 5, and this month so far (Oct 1 – 5) against Sep 1 – 5. A
 * window that ends on a month's last day is whole months, set against whole
 * months: September against all of August, February against all of January.
 *
 * `trend` is the months a month-by-month chart draws: the window's own, but
 * never fewer than two, so a one-month window still has the month it's
 * compared with beside it.
 */
export function monthWindow(end: ISODate, months: number) {
  const from = addMonths(startOfMonth(end), -(months - 1));
  const back = addMonths(end, -months);
  return {
    from,
    to: end,
    prevFrom: addMonths(from, -months),
    prevTo: end === endOfMonth(end) ? endOfMonth(back) : back,
    months: lastMonths(end, months),
    trend: lastMonths(end, Math.max(months, 2)),
  };
}

/**
 * The month a one-month view shows, from the address ("2026-09"): a past
 * month that has something in it, from `earliest` (the oldest transaction's
 * date) up to last month. Null for this month, and for anything else, so a
 * mistyped or stale link still opens on today.
 */
export function parseMonth(raw: string | string[] | undefined, today: ISODate, earliest: ISODate | null): string | null {
  const m = Array.isArray(raw) ? raw[0] : raw;
  if (!m || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m) || !earliest) return null;
  return m < monthKey(today) && m >= monthKey(earliest) ? m : null;
}

/**
 * The months either side of `month` a one-month view can step to, as their
 * keys ("2026-08"), or null where there's nothing: before the oldest
 * transaction, or after this month. This month itself is `null` in the
 * address, so stepping forward onto it gives `current`.
 */
export function monthSteps(month: string | null, today: ISODate, earliest: ISODate | null) {
  const shown = month ?? monthKey(today);
  const older = monthKey(addMonths(`${shown}-01`, -1));
  const newer = monthKey(addMonths(`${shown}-01`, 1));
  return {
    older: earliest && older >= monthKey(earliest) ? older : null,
    newer: month === null ? null : newer === monthKey(today) ? "current" : newer,
  } as const;
}

/**
 * What a Spending or Cash flow address asks for: the range, the past month a
 * one-month view shows (null for this month), the window that makes, and the
 * months either side of it for the stepper (one month only).
 */
export function rangeView(params: Record<string, string | string[] | undefined>, today: ISODate, transactions: Transaction[]) {
  const range = parseRange(params.range);
  const earliest = transactions.reduce<ISODate | null>((m, t) => (m === null || t.date < m ? t.date : m), null);
  const month = range === 1 ? parseMonth(params.month, today, earliest) : null;
  const w = monthWindow(month ? endOfMonth(`${month}-01`) : today, range);
  const step = range === 1 ? { shown: month ?? monthKey(today), ...monthSteps(month, today, earliest) } : undefined;
  return { range, month, w, step };
}

/** The one-month view of `month` ("2026-09") on a screen: this month's has no month in its address. */
export function monthHref(path: string, month: string, today: ISODate): string {
  return month === monthKey(today) ? `${path}?range=1` : `${path}?range=1&month=${month}`;
}

/** A window as a screen's eyebrow names it: "Aug 2026 – Oct 2026", or "Oct 2026" when it's one month. */
export function periodLabel(from: ISODate, to: ISODate): string {
  return monthKey(from) === monthKey(to) ? monthYear(to) : `${monthYear(from)} – ${monthYear(to)}`;
}

/** What a one-month window is set against, named: "August" for the whole of it, "Sep 1 – 5" for part. */
export function againstLabel(from: ISODate, to: ISODate): string {
  return from === startOfMonth(from) && to === endOfMonth(from) ? monthLong(from) : dayRange(from, to);
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

/** The longest merchant search a ledger link carries, as long as the search box takes. */
export const LEDGER_FIND_MAX = 80;

export type LedgerNarrowing = { category: CategoryId } | { find: string };

/**
 * A link's #fragment that opens a ledger narrowed to one category or one
 * merchant. A fragment, not a query: a browser never sends it to a server, so
 * what a person looked for never lands in a request log.
 */
export function ledgerHash(narrow: LedgerNarrowing): string {
  const params: [string, string] = "category" in narrow ? ["category", narrow.category] : ["find", narrow.find.trim().slice(0, LEDGER_FIND_MAX)];
  return `#${new URLSearchParams([params]).toString()}`;
}

/** What a ledger link's #fragment asks for, or null when it asks for nothing a ledger knows. */
export function readLedgerHash(hash: string): LedgerNarrowing | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const category = params.get("category");
  if (category && Object.hasOwn(CATEGORIES, category)) return { category: category as CategoryId };
  const find = params.get("find")?.trim().slice(0, LEDGER_FIND_MAX);
  return find ? { find } : null;
}
