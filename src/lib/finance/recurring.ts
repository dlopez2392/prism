// src/lib/finance/recurring.ts
//
// Recurring-stream detection: paychecks, rent, bills and subscriptions found
// from the transactions themselves, so the forecast works for any provider
// (Plaid has /transactions/recurring/get, but a second aggregator or a CSV
// import would not). A stream is a merchant that repeats on a steady cadence;
// the amount may be fixed (a subscription) or variable (the electric bill, the
// card payment), and the difference matters to the forecast's error band.

import { addDays, addMonths, daysBetween } from "./dates";
import type { Cents, CategoryId, ISODate, Transaction } from "./types";

export type Cadence = "weekly" | "biweekly" | "monthly";

export type StreamKind = "income" | "subscription" | "bill" | "transfer";

export type RecurringStream = {
  id: string;
  merchant: string;
  accountId: string;
  category: CategoryId;
  kind: StreamKind;
  cadence: Cadence;
  /** Signed like transactions: + in, − out. The most recent amount. */
  amount: Cents;
  /** True when amounts drift more than 5% between occurrences. */
  variable: boolean;
  lastDate: ISODate;
  nextDate: ISODate;
  occurrences: number;
  /** Set when the latest fixed charge differs from the one before it. */
  priceChange: { from: Cents; to: Cents; date: ISODate } | null;
  transactionIds: string[];
  /**
   * When this stream pays a card or a loan whose lender states its next
   * payment (debts.ts, withLenderTerms): that payment, instead of an
   * estimate. Signed like `amount`.
   */
  lender?: { accountId: string; dueDate: ISODate; amount: Cents };
};

const LOOKBACK_DAYS = 200;
const CADENCES: { cadence: Cadence; days: number; tolerance: number }[] = [
  { cadence: "weekly", days: 7, tolerance: 1 },
  { cadence: "biweekly", days: 14, tolerance: 2 },
  { cadence: "monthly", days: 30.4, tolerance: 4 },
];

/** Where a fixed, modest charge reads as a subscription rather than a bill. */
const SUBSCRIPTION_CATEGORIES: CategoryId[] = ["fun", "health", "shopping"];
const SUBSCRIPTION_MAX: Cents = 10_000;
/** A small fixed "bill" (cloud storage, a news app) is a subscription too. */
const SMALL_BILL_MAX: Cents = 3_000;

export function normalizeMerchant(merchant: string): string {
  return merchant
    .toLowerCase()
    .replace(/[#*]\s*\d+/g, "")
    .replace(/\s+\d{3,}$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function detectRecurring(txns: Transaction[], today: ISODate): RecurringStream[] {
  const since = addDays(today, -LOOKBACK_DAYS);
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (t.date < since || t.pending || t.amount === 0) continue;
    const key = `${t.accountId}|${normalizeMerchant(t.merchant)}|${t.amount > 0 ? "in" : "out"}`;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }

  const streams: RecurringStream[] = [];
  for (const [key, list] of groups) {
    if (list.length < 3) continue;
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const gaps = list.slice(1).map((t, i) => daysBetween(list[i]!.date, t.date));
    const typical = median(gaps);
    const match = CADENCES.find((c) => Math.abs(typical - c.days) <= c.tolerance);
    if (!match) continue;
    const steady = gaps.filter((g) => Math.abs(g - match.days) <= match.tolerance + 1).length;
    if (steady / gaps.length < 0.75) continue;

    const last = list.at(-1)!;
    // A stream that stopped is not recurring any more: allow one missed cycle.
    if (daysBetween(last.date, today) > match.days * 1.6 + match.tolerance) continue;

    const { variable, priceChange } = amountPattern(list, today);

    const nextDate = nthAfter(last.date, match.cadence, 1);
    const amount = variable ? Math.round(median(list.slice(-3).map((t) => t.amount))) : last.amount;

    streams.push({
      id: key,
      merchant: last.merchant,
      accountId: last.accountId,
      category: last.category,
      kind: kindOf(last, variable),
      cadence: match.cadence,
      amount,
      variable,
      lastDate: last.date,
      nextDate,
      occurrences: list.length,
      priceChange,
      transactionIds: list.map((t) => t.id),
    });
  }
  return streams.sort((a, b) => (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : 0));
}

const same = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * 0.005;

/**
 * Fixed or variable, and whether a fixed charge recently changed price. A
 * subscription that went from $15.49 to $17.99 two months ago is FIXED with a
 * price change, not "variable" — the step is the news, not noise.
 */
export function amountPattern(
  list: Transaction[],
  today: ISODate,
): { variable: boolean; priceChange: RecurringStream["priceChange"] } {
  const a = list.map((t) => Math.abs(t.amount));
  const n = a.length;
  let step = -1;
  for (let i = n - 1; i >= 1; i--) {
    if (!same(a[i]!, a[i - 1]!)) {
      step = i;
      break;
    }
  }
  if (step === -1) return { variable: false, priceChange: null };

  const after = a.slice(step);
  const before = a.slice(Math.max(0, step - 3), step);
  const settledAfter = after.every((x) => same(x, after[0]!));
  const settledBefore = before.length >= 2 && before.every((x) => same(x, before[0]!));
  if (settledAfter && settledBefore) {
    const recent = daysBetween(list[step]!.date, today) <= 120;
    return {
      variable: false,
      priceChange: recent ? { from: list[step - 1]!.amount, to: list[step]!.amount, date: list[step]!.date } : null,
    };
  }
  const recent = a.slice(-4);
  const spread = (Math.max(...recent) - Math.min(...recent)) / Math.max(...recent);
  return { variable: spread > 0.05, priceChange: null };
}

function kindOf(t: Transaction, variable: boolean): StreamKind {
  if (t.category === "income") return "income";
  if (t.category === "transfer") return "transfer";
  const size = Math.abs(t.amount);
  if (!variable && SUBSCRIPTION_CATEGORIES.includes(t.category) && size <= SUBSCRIPTION_MAX) return "subscription";
  if (!variable && t.category === "bills" && size <= SMALL_BILL_MAX) return "subscription";
  return "bill";
}

/** Every occurrence of `stream` from `from` through `to`, inclusive. */
export function occurrences(stream: RecurringStream, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  // Counted from the last REAL charge so month-end clamping never drifts
  // (Jan 31 → Feb 28 → Mar 31, not Mar 28).
  for (let k = 1; k < 400; k++) {
    const d = nthAfter(stream.lastDate, stream.cadence, k);
    if (d > to) break;
    if (d >= from) out.push(d);
  }
  // A charge that is overdue (expected before `from`, not yet seen) is still
  // coming: land it on the first day of the window rather than dropping it.
  if (stream.nextDate < from && (out.length === 0 || out[0] !== from)) out.unshift(from);
  return out;
}

export function nthAfter(date: ISODate, cadence: Cadence, n: number): ISODate {
  return cadence === "monthly" ? addMonths(date, n) : addDays(date, n * cadenceDays(cadence));
}

export function cadenceDays(c: Cadence): number {
  return c === "weekly" ? 7 : c === "biweekly" ? 14 : 30;
}

/** Monthly cost of a stream, for "subscriptions cost you $X a year". */
export function monthlyCost(stream: RecurringStream): Cents {
  const perMonth = stream.cadence === "weekly" ? 52 / 12 : stream.cadence === "biweekly" ? 26 / 12 : 1;
  return Math.round(Math.abs(stream.amount) * perMonth);
}
