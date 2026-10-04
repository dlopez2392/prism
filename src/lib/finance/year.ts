// src/lib/finance/year.ts
//
// One calendar year of a person's money, on one page (/year): what came in,
// what went out, what they kept, where it went, who they paid most, and how
// far their net worth moved. Every figure is counted exactly as the other
// screens count it (cashflow.ts), so the year never disagrees with a month.
//
// Honest about what Prism can see: the year starts where the records do (a
// bank linked in March has no January), a year still under way says so, and a
// comparison with the year before appears only when Prism holds that same
// span of the year before, in full.

import { categoryTotals, inRange, monthlyCashFlow, sumIncome, sumSpending, topMerchants, type MerchantRow, type MonthFlow } from "./cashflow";
import { SPEND_CATEGORIES, isSpendCategory } from "./categories";
import { addDays, monthKey, startOfMonth } from "./dates";
import { incomeKind } from "./income";
import { netWorthSeries } from "./networth";
import { detectRecurring, normalizeMerchant } from "./recurring";
import type { Cents, FinanceData, ISODate, SpendCategoryId, Transaction } from "./types";

export type YearTotals = { income: Cents; spending: Cents; kept: Cents; savingsRate: number | null };

export type YearReview = {
  year: number;
  /** The span counted: Jan 1 (or the first record) to Dec 31 (or today). */
  from: ISODate;
  to: ISODate;
  /** The year is still under way. */
  partial: boolean;
  /** Prism's records start after Jan 1 of this year: the first day it can see. */
  recordsFrom: ISODate | null;
  totals: YearTotals;
  /** The same span of the year before, when Prism holds all of it. */
  before: YearTotals | null;
  /** Jan … Dec (or this month), in and out. */
  months: MonthFlow[];
  /** Spending by category, largest first, with the same span the year before when there is one. */
  categories: { category: SpendCategoryId; amount: Cents; share: number; before: Cents | null }[];
  merchants: MerchantRow[];
  /** The single largest one-off purchase: never rent, a loan or a subscription (anything that repeats). */
  biggest: Transaction | null;
  /** The complete months that cost the most and the least. */
  busiest: MonthFlow | null;
  quietest: MonthFlow | null;
  /** Paychecks and other pay, before anything else came in. */
  pay: Cents;
  /** What the person's subscriptions cost over the span, and how many there were. */
  subscriptions: { total: Cents; count: number; list: { merchant: string; total: Cents }[] };
  /** Net worth at the end of the month before the span's first month, and at its end (or now). */
  netWorth: { start: Cents | null; end: Cents | null };
  transactions: number;
};

const totals = (txns: Transaction[], from: ISODate, to: ISODate): YearTotals => {
  const income = sumIncome(txns, from, to);
  const spending = sumSpending(txns, from, to);
  const kept = income - spending;
  return { income, spending, kept, savingsRate: income > 0 ? kept / income : null };
};

/** The years Prism has any record of, newest first: what the year page offers. */
export function reviewYears(data: Pick<FinanceData, "transactions" | "today">): number[] {
  const years = new Set<number>();
  for (const t of data.transactions) if (t.date <= data.today) years.add(Number(t.date.slice(0, 4)));
  return [...years].sort((a, b) => b - a);
}

/** The year a person most likely means: last year in January and February (taxes, the look back), this year otherwise. */
export function defaultYear(data: Pick<FinanceData, "transactions" | "today">): number {
  const now = Number(data.today.slice(0, 4));
  const years = reviewYears(data);
  const early = Number(data.today.slice(5, 7)) <= 2;
  if (early && years.includes(now - 1)) return now - 1;
  return years.includes(now) || years.length === 0 ? now : years[0]!;
}

export type YearSpan = Pick<YearReview, "from" | "to" | "partial" | "recordsFrom"> & {
  /** The first day Prism has any record of, or null when it has none. */
  first: ISODate | null;
};

/** The stretch of `year` Prism can speak for: Jan 1 or its first record, to Dec 31 or today. */
export function yearSpan(data: Pick<FinanceData, "transactions" | "today">, year: number): YearSpan {
  const first = data.transactions.reduce<ISODate | null>((min, t) => (t.date <= data.today && (min === null || t.date < min) ? t.date : min), null);
  const jan1 = `${year}-01-01`;
  const dec31 = `${year}-12-31`;
  const partial = data.today < dec31;
  const to = partial ? data.today : dec31;
  const recordsFrom = first !== null && first > jan1 && first <= to ? first : null;
  return { from: recordsFrom ?? jan1, to, partial, recordsFrom, first };
}

export function yearReview(data: FinanceData, year: number): YearReview {
  const txns = data.transactions.filter((t) => t.date <= data.today);
  const { from, to, partial, recordsFrom, first } = yearSpan(data, year);

  // The same span, a year earlier — only when the records reach back to its first day.
  const priorFrom = `${year - 1}${from.slice(4)}`;
  const priorTo = to.endsWith("-02-29") ? `${year - 1}-02-28` : `${year - 1}${to.slice(4)}`;
  const hasPrior = first !== null && first <= priorFrom;

  const months: string[] = [];
  for (let m = Number(from.slice(5, 7)); m <= Number(to.slice(5, 7)); m++) months.push(`${year}-${String(m).padStart(2, "0")}`);
  const flows = months.length && from <= to ? monthlyCashFlow(txns.filter((t) => inRange(t, from, to)), months) : [];

  const now = categoryTotals(txns, from, to);
  const then = hasPrior ? categoryTotals(txns, priorFrom, priorTo) : null;
  const spent = SPEND_CATEGORIES.reduce((s, c) => s + Math.max(0, now[c]), 0);
  const categories = SPEND_CATEGORIES.filter((c) => now[c] > 0)
    .map((c) => ({ category: c, amount: now[c], share: spent > 0 ? now[c] / spent : 0, before: then ? then[c] : null }))
    .sort((a, b) => b.amount - a.amount);

  const inSpan = txns.filter((t) => inRange(t, from, to));
  // What repeats, as Prism knows it at the end of the span: rent, loans and subscriptions aren't "a purchase".
  const streams = detectRecurring(txns.filter((t) => t.date <= to), to);
  const regular = new Set(streams.filter((s) => s.kind !== "income").map((s) => `${s.accountId}|${normalizeMerchant(s.merchant)}`));
  let biggest: Transaction | null = null;
  for (const t of inSpan) {
    if (!isSpendCategory(t.category) || t.amount >= 0 || regular.has(`${t.accountId}|${normalizeMerchant(t.merchant)}`)) continue;
    if (!biggest || t.amount < biggest.amount) biggest = t;
  }

  // Busiest and quietest among months that are over and that Prism saw from their first day.
  const complete = flows.filter((f) => f.month !== monthKey(data.today) && `${f.month}-01` >= from);
  const busiest = complete.reduce<MonthFlow | null>((b, f) => (b === null || f.spending > b.spending ? f : b), null);
  const quietest = complete.length > 1 ? complete.reduce<MonthFlow | null>((q, f) => (q === null || f.spending < q.spending ? f : q), null) : null;

  const pay = inSpan.reduce((s, t) => (t.category === "income" && t.amount > 0 && incomeKind(t) === "pay" ? s + t.amount : s), 0);

  // Subscriptions, and every charge from them within the span.
  const subs = streams
    .filter((s) => s.kind === "subscription")
    .map((s) => {
      const key = normalizeMerchant(s.merchant);
      const total = inSpan.reduce((sum, t) => (t.accountId === s.accountId && t.amount < 0 && normalizeMerchant(t.merchant) === key ? sum - t.amount : sum), 0);
      return { merchant: s.merchant, total };
    })
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total);

  // Net worth from month-end balances: the month before the span starts, and the span's last month.
  const series = netWorthSeries(data.accounts, data.today);
  const at = (month: string) => series.find((p) => p.month === month)?.net ?? null;

  return {
    year,
    from,
    to,
    partial,
    recordsFrom,
    totals: totals(txns, from, to),
    before: hasPrior ? totals(txns, priorFrom, priorTo) : null,
    months: flows,
    categories,
    merchants: topMerchants(txns, from, to, 10),
    biggest,
    busiest,
    quietest,
    pay,
    subscriptions: { total: subs.reduce((s, x) => s + x.total, 0), count: subs.length, list: subs.slice(0, 8) },
    netWorth: { start: at(monthKey(addDays(startOfMonth(from), -1))), end: at(monthKey(to)) },
    transactions: inSpan.length,
  };
}
