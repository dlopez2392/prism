// src/lib/finance/budgets.ts
//
// Budget pacing. The naive projection — spent ÷ days elapsed × days in month —
// cries wolf every month on the 2nd, because rent lands on the 1st and a
// straight line through it projects paying rent thirty times. Instead the
// projection asks history: of what this category usually spends in a month,
// how much typically lands AFTER today's day-of-month? Rent: nothing, so
// Housing projects flat. Groceries: about the remaining share of the month.

import { categoryTotals } from "./cashflow";
import { addDays, addMonths, dayOfMonth, daysInMonth, monthKey, startOfMonth } from "./dates";
import { SPEND_CATEGORIES } from "./categories";
import type { Budget, Cents, ISODate, SpendCategoryId, Transaction } from "./types";

export type BudgetState = "on_track" | "at_risk" | "over";

export type BudgetStatus = {
  category: SpendCategoryId;
  limit: Cents;
  spent: Cents;
  /** spent / limit (may exceed 1). */
  used: number;
  /** Fraction of the month elapsed — the "you are here" tick. */
  timeElapsed: number;
  projected: Cents;
  remaining: Cents;
  state: BudgetState;
};

const HISTORY_MONTHS = 3;

/** Average spend in `category` after day-of-month `day`, over the last full months. */
export function typicalSpendAfterDay(
  txns: Transaction[],
  category: SpendCategoryId,
  today: ISODate,
  day: number,
  months = HISTORY_MONTHS,
): Cents {
  let total = 0;
  for (let i = 1; i <= months; i++) {
    const m = addMonths(startOfMonth(today), -i);
    const key = monthKey(m);
    const cutoff = Math.min(day, daysInMonth(m));
    for (const t of txns) {
      if (t.category !== category || monthKey(t.date) !== key) continue;
      if (dayOfMonth(t.date) > cutoff) total -= t.amount;
    }
  }
  return Math.max(0, Math.round(total / months));
}

export function budgetStatuses(budgets: Budget[], txns: Transaction[], today: ISODate): BudgetStatus[] {
  const from = startOfMonth(today);
  const spentBy = categoryTotals(txns, from, today);
  const day = dayOfMonth(today);
  const timeElapsed = day / daysInMonth(today);

  return budgets.map(({ category, limit }) => {
    const spent = Math.max(0, spentBy[category]);
    const projected = spent + typicalSpendAfterDay(txns, category, today, day);
    const state: BudgetState = spent > limit ? "over" : projected > limit * 1.02 ? "at_risk" : "on_track";
    return {
      category,
      limit,
      spent,
      used: limit > 0 ? spent / limit : 0,
      timeElapsed,
      projected,
      remaining: limit - spent,
      state,
    };
  });
}

export function budgetTotals(statuses: BudgetStatus[]) {
  const limit = statuses.reduce((s, b) => s + b.limit, 0);
  const spent = statuses.reduce((s, b) => s + b.spent, 0);
  const projected = statuses.reduce((s, b) => s + Math.max(b.projected, b.spent), 0);
  return { limit, spent, projected, remaining: limit - spent };
}

/** How many days are left in the month, counting today. */
export function daysLeftInMonth(today: ISODate): number {
  return daysInMonth(today) - dayOfMonth(today) + 1;
}

/** The last day of `today`'s month. */
export function monthEnd(today: ISODate): ISODate {
  return addDays(addMonths(startOfMonth(today), 1), -1);
}

/**
 * What each category usually costs a month: the average over the last three
 * FULL months. The editor shows it beside every limit, so a person sets a
 * budget against what's real rather than a guess.
 */
export function typicalMonthlySpend(txns: Transaction[], today: ISODate, months = HISTORY_MONTHS): Record<SpendCategoryId, Cents> {
  const from = addMonths(startOfMonth(today), -months);
  const to = addDays(startOfMonth(today), -1);
  const totals = categoryTotals(txns, from, to);
  return Object.fromEntries(SPEND_CATEGORIES.map((c) => [c, Math.max(0, Math.round(totals[c] / months))])) as Record<SpendCategoryId, Cents>;
}

/** An unconfigured budget should still be useful: draft one from the last three months. */
export function suggestedLimit(threeMonthTotal: Cents): Cents {
  const monthly = threeMonthTotal / 3;
  return Math.max(2_500, Math.ceil(monthly / 2_500) * 2_500);
}

/**
 * Budgets nobody has set yet, drafted from the last three FULL months of
 * spending: a starting point from what's real, one line per category that
 * actually saw spending. A person's own, or a household's from what its
 * members share.
 */
export function draftBudgets(txns: Transaction[], today: ISODate): Budget[] {
  const lastThree = categoryTotals(txns, addMonths(startOfMonth(today), -HISTORY_MONTHS), addDays(startOfMonth(today), -1));
  return SPEND_CATEGORIES.filter((c) => lastThree[c] > 0).map((c) => ({ category: c, limit: suggestedLimit(lastThree[c]) }));
}
