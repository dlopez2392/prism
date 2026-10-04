// src/lib/finance/recurring.ts
//
// Recurring-stream detection: paychecks, rent, bills and subscriptions found
// from the transactions themselves, so the forecast works for any provider
// (Plaid has /transactions/recurring/get, but a second aggregator or a CSV
// import would not). A stream is a merchant that repeats on a steady cadence;
// the amount may be fixed (a subscription) or variable (the electric bill, the
// card payment), and the difference matters to the forecast's error band.
//
// Some bills come only every three, six or twelve months: the car insurance
// renewal, the water bill, a yearly membership. Those are found over two
// years of history (all Plaid sends), only among money going out, and only
// where such a bill lives, because two lookalike charges a year apart are
// far easier to come by than a monthly rhythm.

import { addDays, addMonths, dayOfMonth, dayOfWeek, daysBetween, daysInMonth, isBusinessDay } from "./dates";
import { wholeLines } from "./details";
import type { Cents, CategoryId, ISODate, Transaction } from "./types";

export type Cadence = "weekly" | "biweekly" | "semimonthly" | "monthly" | "quarterly" | "semiannual" | "annual";
/** The cadences that come round less often than once a month. */
export type LongCadence = Extract<Cadence, "quarterly" | "semiannual" | "annual">;

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

/** Long enough to see a yearly bill twice: Plaid sends up to two years. */
const LONG_LOOKBACK_DAYS = 800;
/**
 * Every three, six and twelve months. `least` is how many charges it takes
 * to call it a rhythm; `grace` is how late the next one may be before the
 * bill counts as stopped (a missed renewal is a cancelled one, not a
 * skipped cycle).
 */
const LONG_CADENCES: { cadence: LongCadence; days: number; tolerance: number; least: number; grace: number }[] = [
  { cadence: "quarterly", days: 91.3, tolerance: 8, least: 3, grace: 14 },
  { cadence: "semiannual", days: 182.6, tolerance: 12, least: 2, grace: 21 },
  { cadence: "annual", days: 365.25, tolerance: 15, least: 2, grace: 30 },
];
/** Where two charges a year apart are a coincidence, not a bill: money moving between accounts, meals, trips. (Pay comes in, and only money going out is tried.) */
const NOT_LONG: CategoryId[] = ["transfer", "food", "travel"];
/** Two charges alone must be within this of the latest: a renewal that crept up, not two unrelated purchases. */
const LONG_PAIR_SPREAD = 0.3;

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
  const longSince = addDays(today, -LONG_LOOKBACK_DAYS);
  const groups = new Map<string, Transaction[]>();
  // A bill the person split is still one bill: its parts are joined back first.
  for (const t of wholeLines(txns)) {
    if (t.date < longSince || t.pending || t.amount === 0) continue;
    const key = `${t.accountId}|${normalizeMerchant(t.merchant)}|${t.amount > 0 ? "in" : "out"}`;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }

  const streams: RecurringStream[] = [];
  for (const [key, all] of groups) {
    all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    // Monthly and more often, from the last 200 days; only what isn't that is tried as a bill that comes less often.
    const recent = all.filter((t) => t.date >= since);
    const stream = (recent.length >= 3 ? frequentStream(key, recent, today) : null) ?? longStream(key, all, today);
    if (stream) streams.push(stream);
  }
  return streams.sort((a, b) => (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : 0));
}

/** A merchant that comes round every week, fortnight, half-month or month, from its charges (oldest first). */
function frequentStream(key: string, list: Transaction[], today: ISODate): RecurringStream | null {
  const gaps = list.slice(1).map((t, i) => daysBetween(list[i]!.date, t.date));
  const typical = median(gaps);
  const match = CADENCES.find((c) => Math.abs(typical - c.days) <= c.tolerance);
  const steady = match ? gaps.filter((g) => Math.abs(g - match.days) <= match.tolerance + 1).length / gaps.length >= 0.75 : false;
  const last = list.at(-1)!;
  // Pay follows a rule, and the rule is what makes the next payday exact.
  const pay = last.category === "income" && last.amount > 0 ? paySchedule(list.map((t) => t.date), steady ? match!.cadence : null, typical) : null;
  const cadence = pay?.cadence ?? (steady ? match!.cadence : null);
  if (!cadence) return null;

  // A stream that stopped is not recurring any more: allow one missed cycle.
  const period = cadence === "semimonthly" ? SEMIMONTHLY : CADENCES.find((c) => c.cadence === cadence)!;
  if (daysBetween(last.date, today) > period.days * 1.6 + period.tolerance) return null;

  const { variable, priceChange } = amountPattern(list, today);
  const amount = variable ? Math.round(median(list.slice(-3).map((t) => t.amount))) : last.amount;
  return streamOf(key, list, { cadence, kind: kindOf(last, variable), amount, variable, priceChange, ...(pay?.schedule ? { schedule: pay.schedule } : {}) });
}

/**
 * A bill that comes every three, six or twelve months, from up to two years
 * of its charges (oldest first). Money going out only, never where a lookalike
 * is likely (NOT_LONG); most gaps must fit, as for any stream; and when there
 * are only two charges, their amounts must be close. The amount expected is
 * the latest one: a renewal rarely comes in under the last.
 */
function longStream(key: string, list: Transaction[], today: ISODate): RecurringStream | null {
  const last = list.at(-1)!;
  if (last.amount > 0 || NOT_LONG.includes(last.category)) return null;
  const gaps = list.slice(1).map((t, i) => daysBetween(list[i]!.date, t.date));
  const typical = median(gaps);
  // One charge has no gaps, so nothing matches: every cadence needs at least two.
  const match = LONG_CADENCES.find((c) => Math.abs(typical - c.days) <= c.tolerance);
  if (!match || list.length < match.least) return null;
  if (gaps.filter((g) => Math.abs(g - match.days) <= match.tolerance).length / gaps.length < 0.75) return null;
  const latest = Math.abs(last.amount);
  if (list.length === 2 && Math.abs(Math.abs(list[0]!.amount) - latest) > latest * LONG_PAIR_SPREAD) return null;
  // One missed renewal means it was cancelled: no second cycle of grace.
  if (daysBetween(last.date, today) > match.days + match.grace) return null;

  const { variable, priceChange } = amountPattern(list, today);
  return streamOf(key, list, { cadence: match.cadence, kind: "bill", amount: last.amount, variable, priceChange });
}

function streamOf(
  key: string,
  list: Transaction[],
  found: Pick<RecurringStream, "cadence" | "kind" | "amount" | "variable" | "priceChange" | "schedule">,
): RecurringStream {
  const last = list.at(-1)!;
  const { schedule, ...rest } = found;
  return {
    id: key,
    merchant: last.merchant,
    accountId: last.accountId,
    category: last.category,
    ...rest,
    lastDate: last.date,
    nextDate: nthOccurrence({ lastDate: last.date, cadence: found.cadence, ...(schedule ? { schedule } : {}) }, 1),
    occurrences: list.length,
    transactionIds: list.map((t) => t.id),
    ...(schedule ? { schedule } : {}),
  };
}

/** True for a stream that comes round less often than once a month. */
export function isLong(c: Cadence): c is LongCadence {
  return c === "quarterly" || c === "semiannual" || c === "annual";
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

/** How often each cadence comes round: by the calendar (the same day, months apart) or by the day count. */
const STEP: Record<Cadence, { months: number } | { days: number }> = {
  weekly: { days: 7 },
  biweekly: { days: 14 },
  semimonthly: { days: 15 },
  monthly: { months: 1 },
  quarterly: { months: 3 },
  semiannual: { months: 6 },
  annual: { months: 12 },
};
const PER_YEAR: Record<Cadence, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, quarterly: 4, semiannual: 2, annual: 1 };

export function nthAfter(date: ISODate, cadence: Cadence, n: number): ISODate {
  const step = STEP[cadence];
  return "months" in step ? addMonths(date, n * step.months) : addDays(date, n * step.days);
}

/** How many times a year a stream comes round. */
export function perYear(c: Cadence): number {
  return PER_YEAR[c];
}

/** Monthly cost of a stream, for "subscriptions cost you $X a year", and what a bill that comes less often asks to be put aside each month. */
export function monthlyCost(stream: RecurringStream): Cents {
  return Math.round((Math.abs(stream.amount) * perYear(stream.cadence)) / 12);
}

/**
 * The bills that come less often than monthly (always money going out), in
 * the order given (detectRecurring's: soonest first), and what putting aside
 * for all of them each month comes to.
 */
export function setAside(streams: RecurringStream[]): { bills: RecurringStream[]; monthly: Cents } {
  const bills = streams.filter((s) => isLong(s.cadence));
  return { bills, monthly: bills.reduce((sum, s) => sum + monthlyCost(s), 0) };
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
