// src/lib/finance/estimated-tax.ts
//
// Estimated tax: the four days a year the IRS expects tax that no paycheck
// withholds (side income, a business, investments), and what Prism can say
// about each. The due dates are the 15th of April, June and September and
// the next January, moved to the next business day when one lands on a
// weekend or a holiday that closes the IRS (Martin Luther King Jr. Day,
// Emancipation Day in Washington, D.C.).
//
// It's only for someone who looks like they pay it: their own business
// accounts showed a profit this year, or last year's return
// (finance/tax-return.ts) had estimated payments or a balance due of $1,000
// or more, the line at which the IRS generally expects them.
//
// With last year's return, each quarter carries a target: a quarter of the
// safe-harbor amount (last year's total tax, 110% over $150,000 AGI) less
// last year's withholding, on the assumption, said out loud, that this year's
// withholding is about the same. Against it, the payments to the IRS Prism
// sees from the person's accounts, counted by the day each due date passed.
// A payment in the spring that matches last year's balance due to the
// dollar is last year's bill, not this year's estimate, and is left out.
//
// The rule, never advice: what a quarter needs depends on what's withheld
// and what's earned, which Prism can't see, and Prism never pays anything.
// Taxes, the check-in, the calendar feed and the connector all read this.
//
// Pure: reads the money.

import { addDays, daysBetween, dayOfWeek } from "./dates";
import { wholeLines } from "./details";
import { scheduleC } from "./schedule-c";
import { returnFacts, type TaxReturn } from "./tax-return";
import type { Cents, FinanceData, ISODate, Transaction } from "./types";

export type Quarter = 1 | 2 | 3 | 4;

export type EstimatedQuarter = {
  n: Quarter;
  due: ISODate;
  /** What the payments should add up to by this due date, at last year's safe harbor and withholding; null without last year's return. */
  target: Cents | null;
  /** What Prism saw paid to the IRS for this tax year by this due date. */
  paid: Cents;
  /** "paid": the target is met (or, without one, something was paid); "short": the date passed below it; "soon": due within SOON_DAYS; "upcoming": later. */
  state: "paid" | "short" | "soon" | "upcoming";
};

export type EstimatedTax = {
  taxYear: number;
  /** Why it's shown. */
  why: "business" | "estimated" | "owed";
  quarters: EstimatedQuarter[];
  /** The next due date that hasn't passed, or null once the year's last has. */
  next: EstimatedQuarter | null;
  /** From last year's return: the safe-harbor total, last year's withholding, and what that leaves each quarter. */
  safeHarbor: { amount: Cents; share: 1 | 1.1; lastYear: number } | null;
  withheldLastYear: Cents | null;
  perQuarter: Cents | null;
  /** The payments to the IRS Prism counts toward this tax year, oldest first. */
  payments: Transaction[];
  paidTotal: Cents;
  /** Last year's balance due, paid this spring and so not counted. */
  lastYearsBill: Transaction | null;
  /** This tax year's business profit so far, as the business accounts saw it. */
  businessNet: Cents | null;
};

/** A due date this close is "soon". */
export const SOON_DAYS = 14;
/** A balance due this big last year generally means estimated payments this year. */
const OWED_LINE: Cents = 100_000;
/** Payments to the federal tax collector, by name: never a state's, never a refund. */
const IRS = /\b(irs|usataxpymt|eftps|irs direct pay|us treasury tax|treas tax)\b/i;
const NOT_IRS = /\b(refund|state|franchise tax board|dept of revenue|department of revenue|comptroller)\b/i;

const iso = (y: number, m: number, d: number): ISODate => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The nth weekday (0 Sunday) of a month. */
function nthWeekday(y: number, m: number, weekday: number, n: number): ISODate {
  let d = iso(y, m, 1);
  while (dayOfWeek(d) !== weekday) d = addDays(d, 1);
  return addDays(d, 7 * (n - 1));
}

/** Washington, D.C.'s Emancipation Day as observed: a Saturday's is the Friday before, a Sunday's the Monday after. */
function emancipationDay(y: number): ISODate {
  const d = iso(y, 4, 16);
  const w = dayOfWeek(d);
  return w === 6 ? addDays(d, -1) : w === 0 ? addDays(d, 1) : d;
}

/** A due date moved past weekends and the holidays that can land on one. */
function businessDay(d: ISODate): ISODate {
  const y = Number(d.slice(0, 4));
  const holidays = new Set([nthWeekday(y, 1, 1, 3), emancipationDay(y)]);
  let out = d;
  while (dayOfWeek(out) === 0 || dayOfWeek(out) === 6 || holidays.has(out)) out = addDays(out, 1);
  return out;
}

/** The four due dates for a tax year. */
export function dueDates(taxYear: number): { n: Quarter; due: ISODate }[] {
  return [
    { n: 1, due: businessDay(iso(taxYear, 4, 15)) },
    { n: 2, due: businessDay(iso(taxYear, 6, 15)) },
    { n: 3, due: businessDay(iso(taxYear, 9, 15)) },
    { n: 4, due: businessDay(iso(taxYear + 1, 1, 15)) },
  ];
}

/** The tax year whose payments are being made now: last year's until its January payment is due, this year's after. */
export function paymentYear(today: ISODate): number {
  const y = Number(today.slice(0, 4));
  return today <= dueDates(y - 1)[3]!.due ? y - 1 : y;
}

/** A line of money out to the IRS, settled. */
function toIrs(t: Transaction): boolean {
  return !t.pending && t.amount < 0 && IRS.test(t.merchant) && !NOT_IRS.test(t.merchant);
}

type Data = Pick<FinanceData, "transactions" | "today" | "taxReturns" | "businessAccountIds" | "businessMarks" | "hiddenAccounts" | "accounts">;

/** The tax year being paid now, or null when nothing says the person pays estimated tax. */
export function estimatedTax(data: Data): EstimatedTax | null {
  const taxYear = paymentYear(data.today);
  const prior: TaxReturn | null = (data.taxReturns ?? []).find((r) => r.year === taxYear - 1) ?? null;
  const business = scheduleC(data, taxYear);
  const businessNet = business && business.lines.length ? business.net : null;
  const why: EstimatedTax["why"] | null =
    businessNet !== null && businessNet > 0 ? "business" : prior?.estimated ? "estimated" : prior?.owed !== null && prior?.owed !== undefined && prior.owed >= OWED_LINE ? "owed" : null;
  if (!why) return null;

  const facts = prior ? returnFacts(prior) : null;
  const safeHarbor = facts?.safeHarbor ? { ...facts.safeHarbor, lastYear: prior!.year } : null;
  const withheldLastYear = prior?.withheld ?? null;
  // Whole dollars, rounded up: a quarter is never stated a cent short.
  const perQuarter = safeHarbor ? Math.ceil(Math.max(0, safeHarbor.amount - (withheldLastYear ?? 0)) / 4 / 100) * 100 : null;

  // This tax year's payments run from the day after last year's January payment was due to this year's.
  const dates = dueDates(taxYear);
  const from = addDays(dueDates(taxYear - 1)[3]!.due, 1);
  const to = dates[3]!.due;
  const lines = wholeLines(data.transactions).filter((t) => t.date >= from && t.date <= to && t.date <= data.today && toIrs(t));
  // Last year's balance due, paid by its April deadline: not this year's estimate.
  const owed = prior?.owed ?? null;
  const lastYearsBill = owed !== null && owed > 0 ? (lines.find((t) => t.date <= dates[0]!.due && Math.abs(-t.amount - owed) <= 100) ?? null) : null;
  const payments = lines.filter((t) => t !== lastYearsBill).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const paidBy = (d: ISODate) => payments.filter((t) => t.date <= d).reduce((s, t) => s - t.amount, 0);

  const quarters: EstimatedQuarter[] = dates.map(({ n, due }) => {
    const target = perQuarter === null ? null : perQuarter * n;
    const paid = paidBy(due);
    const passed = due < data.today;
    const state: EstimatedQuarter["state"] = passed
      ? (target === null ? paid > 0 : paid >= target)
        ? "paid"
        : "short"
      : target !== null && paid >= target
        ? "paid"
        : daysBetween(data.today, due) <= SOON_DAYS
          ? "soon"
          : "upcoming";
    return { n, due, target, paid, state };
  });

  return {
    taxYear,
    why,
    quarters,
    next: quarters.find((q) => q.due >= data.today) ?? null,
    safeHarbor,
    withheldLastYear,
    perQuarter,
    payments,
    paidTotal: payments.reduce((s, t) => s - t.amount, 0),
    lastYearsBill,
    businessNet,
  };
}

/** A due date for the calendar feed: the quarter, its tax year, and what's due by it, when Prism knows. */
export type TaxDue = { due: ISODate; quarter: Quarter; taxYear: number; amount: Cents | null };

/** The due dates still to come, for the calendar feed: only the dates and the quarter's amount, nothing else. */
export function taxDues(data: Data): TaxDue[] {
  const e = estimatedTax(data);
  if (!e) return [];
  return e.quarters.filter((q) => q.due >= data.today).map((q) => ({ due: q.due, quarter: q.n, taxYear: e.taxYear, amount: e.perQuarter }));
}

/** A stored snapshot's due date, checked before it's written into anyone's calendar. */
export function validTaxDue(x: unknown): x is TaxDue {
  const d = x as Partial<TaxDue> | null;
  return (
    !!d &&
    typeof d.due === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(d.due) &&
    [1, 2, 3, 4].includes(d.quarter as number) &&
    Number.isSafeInteger(d.taxYear) &&
    (d.amount === null || (Number.isSafeInteger(d.amount) && (d.amount as number) >= 0))
  );
}
