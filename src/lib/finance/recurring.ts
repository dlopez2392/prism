// src/lib/finance/recurring.ts
//
// Recurring-stream detection: paychecks, rent, bills and subscriptions found
// from the transactions themselves, so the forecast works for any provider
// (Plaid has /transactions/recurring/get, but a second aggregator or a CSV
// import would not). A stream is a merchant that repeats on a steady cadence;
// the amount may be fixed (a subscription) or variable (the electric bill, the
// card payment), and the difference matters to the forecast's error band.

import { addDays, addMonths, dayOfMonth, dayOfWeek, daysBetween, daysInMonth, isBusinessDay } from "./dates";
import type { Cents, CategoryId, ISODate, Transaction } from "./types";

export type Cadence = "weekly" | "biweekly" | "semimonthly" | "monthly";

/**
 * When pay actually lands. Employers pay by a rule — every other Friday, the
 * 15th and the last day of the month, the second Wednesday — and move a
 * payday that falls on a weekend or a bank holiday to the business day
 * before. Only income streams carry one; a stream without one simply repeats
 * from its last date.
 */
export type PaySchedule =
  | { kind: "weekday"; weekday: number }
  /** Days of the month, 1–31: 31 (or any day a month doesn't have) is its last day. One day monthly, two twice a month. */
  | { kind: "monthDays"; days: number[] }
  /** The nth weekday of each month (Social Security's second Wednesday); nth -1 is the last. */
  | { kind: "nthWeekday"; weekday: number; nth: number };

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
  /** Income only: the rule its dates follow, so the next payday is exact. */
  schedule?: PaySchedule;
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
/** Twice a month is found from the days pay lands on, not the gaps between them; this only says when it stopped. */
const SEMIMONTHLY = { days: 15.2, tolerance: 3 };

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
    const steady = match ? gaps.filter((g) => Math.abs(g - match.days) <= match.tolerance + 1).length / gaps.length >= 0.75 : false;
    const last = list.at(-1)!;
    // Pay follows a rule, and the rule is what makes the next payday exact.
    const pay = last.category === "income" && last.amount > 0 ? paySchedule(list.map((t) => t.date), steady ? match!.cadence : null, typical) : null;
    const cadence = pay?.cadence ?? (steady ? match!.cadence : null);
    if (!cadence) continue;

    // A stream that stopped is not recurring any more: allow one missed cycle.
    const period = cadence === "semimonthly" ? SEMIMONTHLY : CADENCES.find((c) => c.cadence === cadence)!;
    if (daysBetween(last.date, today) > period.days * 1.6 + period.tolerance) continue;

    const { variable, priceChange } = amountPattern(list, today);
    const amount = variable ? Math.round(median(list.slice(-3).map((t) => t.amount))) : last.amount;
    const shape = { lastDate: last.date, cadence, ...(pay?.schedule ? { schedule: pay.schedule } : {}) };

    streams.push({
      id: key,
      merchant: last.merchant,
      accountId: last.accountId,
      category: last.category,
      kind: kindOf(last, variable),
      cadence,
      amount,
      variable,
      lastDate: last.date,
      nextDate: nthOccurrence(shape, 1),
      occurrences: list.length,
      priceChange,
      transactionIds: list.map((t) => t.id),
      ...(pay?.schedule ? { schedule: pay.schedule } : {}),
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
export function occurrences(stream: Pick<RecurringStream, "lastDate" | "cadence" | "schedule" | "nextDate">, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let k = 0;
  for (const d of upcoming(stream)) {
    if (d > to || ++k >= 400) break;
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
  return c === "weekly" ? 7 : c === "biweekly" ? 14 : c === "semimonthly" ? 15 : 30;
}

/** How many times a year a stream comes round. */
export function perYear(c: Cadence): number {
  return c === "weekly" ? 52 : c === "biweekly" ? 26 : c === "semimonthly" ? 24 : 12;
}

/** Monthly cost of a stream, for "subscriptions cost you $X a year". */
export function monthlyCost(stream: RecurringStream): Cents {
  return Math.round((Math.abs(stream.amount) * perYear(stream.cadence)) / 12);
}

type Shape = Pick<RecurringStream, "lastDate" | "cadence" | "schedule">;

/**
 * The stream's dates after its last real one, in order. Without a schedule,
 * counted from the last REAL charge so month-end clamping never drifts (Jan 31
 * → Feb 28 → Mar 31, not Mar 28). With one, each is the rule's next date,
 * moved to the day before when banks are closed (`open`: bank holidays
 * included, unless a calendar that can't express them asks for weekdays only).
 */
export function* upcoming(s: Shape, open: (d: ISODate) => boolean = isBusinessDay): Generator<ISODate> {
  const back = (d: ISODate) => {
    while (!open(d)) d = addDays(d, -1);
    return d;
  };
  const sch = s.schedule;
  if (!sch) {
    for (let k = 1; ; k++) yield nthAfter(s.lastDate, s.cadence, k);
  }
  if (sch.kind === "weekday") {
    const step = s.cadence === "weekly" ? 7 : 14;
    const nominal = nominalOf(s.lastDate, (d) => dayOfWeek(d) === sch.weekday);
    for (let k = 1; ; k++) yield back(addDays(nominal, k * step));
  }
  let d = nominalOf(s.lastDate, (x) => onRule(x, sch));
  for (;;) {
    do d = addDays(d, 1);
    while (!onRule(d, sch));
    yield back(d);
  }
}

/** The stream's nth date after its last real one (n ≥ 1). */
export function nthOccurrence(s: Shape, n: number): ISODate {
  let k = 0;
  for (const d of upcoming(s)) if (++k === n) return d;
  return s.lastDate;
}

/**
 * The days a payment made on `date` could have been due: that day, and the
 * run of days after it when banks were shut (paid Friday for a Saturday).
 */
export function dueCandidates(date: ISODate): ISODate[] {
  const out = [date];
  for (let d = addDays(date, 1); !isBusinessDay(d) && out.length < 5; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The day `date`'s payment was due under a rule: the first candidate the rule names, else the date itself. */
function nominalOf(date: ISODate, test: (d: ISODate) => boolean): ISODate {
  return dueCandidates(date).find(test) ?? date;
}

/** A day the rule names. */
function onRule(d: ISODate, sch: Exclude<PaySchedule, { kind: "weekday" }>): boolean {
  const dom = dayOfMonth(d);
  if (sch.kind === "monthDays") return sch.days.some((x) => Math.min(x, daysInMonth(d)) === dom);
  return dayOfWeek(d) === sch.weekday && (sch.nth === -1 ? dom + 7 > daysInMonth(d) : Math.ceil(dom / 7) === sch.nth);
}

/** A day of the month as a rule names it: the last day is 31, whatever the month. */
const ruleDay = (d: ISODate) => (dayOfMonth(d) === daysInMonth(d) ? 31 : dayOfMonth(d));

/**
 * The rule deposits follow, when they follow one. Every payday must fit it
 * (bar one in ten, for an off-cycle bonus from the same payer); a rule that
 * fits only some is no rule.
 */
export function paySchedule(dates: ISODate[], gapCadence: Cadence | null, typicalGap: number): { cadence: Cadence; schedule: PaySchedule } | null {
  // Payroll never lands when banks are shut; a payer that has (interest posted on a Saturday) keeps no such rule.
  if (dates.some((d) => !isBusinessDay(d))) return null;
  const fits = (hits: number) => hits >= dates.length - Math.floor(dates.length / 10);
  const candidates = dates.map(dueCandidates);

  // Every week or every other week: the same weekday, give or take a holiday.
  if (gapCadence === "weekly" || gapCadence === "biweekly") {
    for (let w = 1; w <= 5; w++) {
      if (fits(candidates.filter((c) => c.some((d) => dayOfWeek(d) === w)).length)) return { cadence: gapCadence, schedule: { kind: "weekday", weekday: w } };
    }
  }

  // Twice a month: two days of the month about a fortnight apart, taken in turn.
  if (dates.length >= 4 && typicalGap >= 12 && typicalGap <= 18) {
    const days = candidates.map((c) => new Set(c.map(ruleDay)));
    const all = [...new Set(days.flatMap((d) => [...d]))].sort((a, b) => a - b);
    let best: { pair: [number, number]; hits: number } | null = null;
    for (const a of all) {
      for (const b of all) {
        const span = Math.min(b, 30) - a;
        if (b <= a || span < 13 || span > 17) continue;
        const onA = days.filter((d) => d.has(a)).length;
        const onB = days.filter((d) => d.has(b) && !d.has(a)).length;
        if (Math.abs(onA - onB) > 1 + Math.floor(dates.length / 10)) continue;
        if (!best || onA + onB > best.hits || (onA + onB === best.hits && b === 31)) best = { pair: [a, b], hits: onA + onB };
      }
    }
    if (best && fits(best.hits)) return { cadence: "semimonthly", schedule: { kind: "monthDays", days: best.pair } };
  }

  if (gapCadence === "monthly") {
    // The nth weekday of the month (benefits, some pensions).
    const last = dates.at(-1)!;
    const weekday = dayOfWeek(last);
    const nth = dayOfMonth(last) + 7 > daysInMonth(last) ? -1 : Math.ceil(dayOfMonth(last) / 7);
    const nthFits = dates.filter((d) => dayOfWeek(d) === weekday && (nth === -1 ? dayOfMonth(d) + 7 > daysInMonth(d) : Math.ceil(dayOfMonth(d) / 7) === nth)).length;
    // A date that lands on the same weekday every month is rare for a day-of-month rule: at least three to say so.
    if (dates.length >= 3 && fits(nthFits) && new Set(dates.map(dayOfMonth)).size > 1) return { cadence: "monthly", schedule: { kind: "nthWeekday", weekday, nth } };
    // One day of the month.
    const days = candidates.map((c) => new Set(c.map(ruleDay)));
    const counts = new Map<number, number>();
    for (const d of days) for (const x of d) counts.set(x, (counts.get(x) ?? 0) + 1);
    // The most dates, then the day paid on itself most often (the 15th, not the Sunday it moved from).
    const exact = (x: number) => dates.filter((d) => ruleDay(d) === x).length;
    const [day] = [...counts].sort((p, q) => q[1] - p[1] || exact(q[0]) - exact(p[0]) || p[0] - q[0])[0] ?? [];
    if (day !== undefined && fits(counts.get(day)!)) return { cadence: "monthly", schedule: { kind: "monthDays", days: [day] } };
  }
  return null;
}
