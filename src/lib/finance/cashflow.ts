// src/lib/finance/cashflow.ts
//
// Where the money came from and where it went. Pure functions over
// transactions; every screen that shows spending gets its numbers here, so the
// donut, the Sankey and the budget rings can never disagree.
//
// Sign conventions: transactions are signed (in +, out −). Everything this
// module RETURNS as "spending" is a positive number of cents. A refund inside a
// spending category is a positive transaction and reduces that category's
// spending, which is what a person means by "I spent $40 on shoes, then
// returned one pair".

import { CATEGORIES, SPEND_CATEGORIES, isSpendCategory } from "./categories";
import { addDays, dayOfMonth, daysInMonth, eachDay, monthKey, startOfMonth } from "./dates";
import type { Cents, ISODate, SpendCategoryId, Transaction } from "./types";

export type MonthFlow = {
  month: string;
  income: Cents;
  spending: Cents;
  net: Cents;
  /** net / income, or null when there was no income to save from. */
  savingsRate: number | null;
};

export function inRange(t: Transaction, from: ISODate, to: ISODate): boolean {
  return t.date >= from && t.date <= to;
}

export function isSpending(t: Transaction): boolean {
  return isSpendCategory(t.category);
}

export function monthlyCashFlow(txns: Transaction[], months: string[]): MonthFlow[] {
  const byMonth = new Map(months.map((m) => [m, { income: 0, spending: 0 }]));
  for (const t of txns) {
    const row = byMonth.get(monthKey(t.date));
    if (!row) continue;
    if (t.category === "income") row.income += t.amount;
    else if (isSpending(t)) row.spending -= t.amount;
  }
  return months.map((month) => {
    const { income, spending } = byMonth.get(month)!;
    const net = income - spending;
    return { month, income, spending, net, savingsRate: income > 0 ? net / income : null };
  });
}

export type CategoryTotal = { category: SpendCategoryId; amount: Cents };

export function categoryTotals(txns: Transaction[], from: ISODate, to: ISODate): Record<SpendCategoryId, Cents> {
  const out = Object.fromEntries(SPEND_CATEGORIES.map((c) => [c, 0])) as Record<SpendCategoryId, Cents>;
  for (const t of txns) {
    if (!inRange(t, from, to) || !isSpendCategory(t.category)) continue;
    out[t.category] -= t.amount;
  }
  return out;
}

export type CategoryRow = {
  category: SpendCategoryId;
  amount: Cents;
  share: number;
  previous: Cents;
  /** (amount − previous) / previous; null when there was nothing before. */
  change: number | null;
};

/** This period vs the one before it, largest first, zero rows dropped. */
export function categoryBreakdown(
  txns: Transaction[],
  range: { from: ISODate; to: ISODate },
  previous: { from: ISODate; to: ISODate },
): CategoryRow[] {
  const now = categoryTotals(txns, range.from, range.to);
  const before = categoryTotals(txns, previous.from, previous.to);
  const total = SPEND_CATEGORIES.reduce((s, c) => s + Math.max(0, now[c]), 0);
  return SPEND_CATEGORIES.map((category) => ({
    category,
    amount: now[category],
    share: total > 0 ? Math.max(0, now[category]) / total : 0,
    previous: before[category],
    change: before[category] > 0 ? (now[category] - before[category]) / before[category] : null,
  }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

export type MonthByCategory = { month: string } & Record<SpendCategoryId, Cents>;

export function monthlyByCategory(txns: Transaction[], months: string[]): MonthByCategory[] {
  const rows = new Map(
    months.map((m) => [m, { month: m, ...Object.fromEntries(SPEND_CATEGORIES.map((c) => [c, 0])) } as MonthByCategory]),
  );
  for (const t of txns) {
    const row = rows.get(monthKey(t.date));
    if (!row || !isSpendCategory(t.category)) continue;
    row[t.category] -= t.amount;
  }
  return months.map((m) => rows.get(m)!);
}

/**
 * Cumulative spending by day of month — the "spending pace" line. Returns one
 * value per calendar day of the month, up to `through` (inclusive) when given.
 */
export function cumulativeSpend(txns: Transaction[], monthStart: ISODate, through?: ISODate): Cents[] {
  const days = daysInMonth(monthStart);
  const perDay = new Array<Cents>(days).fill(0);
  const key = monthKey(monthStart);
  for (const t of txns) {
    if (monthKey(t.date) !== key || !isSpending(t)) continue;
    perDay[dayOfMonth(t.date) - 1]! -= t.amount;
  }
  const last = through && monthKey(through) === key ? dayOfMonth(through) : days;
  const out: Cents[] = [];
  let run = 0;
  for (let i = 0; i < last; i++) out.push((run += perDay[i]!));
  return out;
}

export function dailySpend(txns: Transaction[], from: ISODate, to: ISODate): { date: ISODate; amount: Cents }[] {
  const perDay = new Map(eachDay(from, to).map((d) => [d, 0]));
  for (const t of txns) {
    if (!perDay.has(t.date) || !isSpending(t)) continue;
    perDay.set(t.date, perDay.get(t.date)! - t.amount);
  }
  return [...perDay].map(([date, amount]) => ({ date, amount: Math.max(0, amount) }));
}

export type MerchantRow = { merchant: string; amount: Cents; count: number; category: SpendCategoryId };

export function topMerchants(txns: Transaction[], from: ISODate, to: ISODate, limit = 8): MerchantRow[] {
  const rows = new Map<string, MerchantRow>();
  for (const t of txns) {
    if (!inRange(t, from, to) || !isSpendCategory(t.category)) continue;
    const row = rows.get(t.merchant) ?? { merchant: t.merchant, amount: 0, count: 0, category: t.category };
    row.amount -= t.amount;
    row.count += 1;
    rows.set(t.merchant, row);
  }
  return [...rows.values()].filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, limit);
}

export type IncomeSource = { name: string; amount: Cents };

/**
 * Income grouped into at most `max` named sources; the tail folds into
 * "Other income" so the Sankey never needs a ninth colour.
 */
export function incomeSources(txns: Transaction[], from: ISODate, to: ISODate, max = 3): IncomeSource[] {
  const rows = new Map<string, Cents>();
  for (const t of txns) {
    if (!inRange(t, from, to) || t.category !== "income" || t.amount <= 0) continue;
    const name = incomeLabel(t.merchant);
    rows.set(name, (rows.get(name) ?? 0) + t.amount);
  }
  const sorted = [...rows].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1).reduce((s, r) => s + r.amount, 0);
  return [...head, { name: "Other income", amount: rest }];
}

/** "Lumen Design Co. payroll" → "Paycheck"; everything else keeps its name. */
export function incomeLabel(merchant: string): string {
  const m = merchant.toLowerCase();
  if (m.includes("payroll") || m.includes("salary") || m.includes("direct dep")) return "Paycheck";
  if (m.includes("interest")) return "Interest";
  if (m.includes("client") || m.includes("freelance") || m.includes("invoice")) return "Side work";
  return merchant;
}

/** Month-to-date range for `today`, and the same span of the month before. */
export function monthToDate(today: ISODate) {
  const from = startOfMonth(today);
  const prevFrom = startOfMonth(addDays(from, -1));
  const prevDays = daysInMonth(prevFrom);
  const prevTo = addDays(prevFrom, Math.min(dayOfMonth(today), prevDays) - 1);
  return { from, to: today, prevFrom, prevTo, prevMonthEnd: addDays(from, -1) };
}

export function sumSpending(txns: Transaction[], from: ISODate, to: ISODate): Cents {
  return txns.reduce((s, t) => (inRange(t, from, to) && isSpending(t) ? s - t.amount : s), 0);
}

export function sumIncome(txns: Transaction[], from: ISODate, to: ISODate): Cents {
  return txns.reduce((s, t) => (inRange(t, from, to) && t.category === "income" ? s + t.amount : s), 0);
}

export function categoryName(c: SpendCategoryId): string {
  return CATEGORIES[c].label;
}
