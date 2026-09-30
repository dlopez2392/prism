// src/lib/finance/model.ts
//
// One pass from raw FinanceData to everything the screens draw. Screens call
// `analyze` and read fields; they never re-derive a number, so two cards on
// the same page cannot disagree about how much was spent.

import { budgetStatuses, budgetTotals } from "./budgets";
import { withLenderTerms } from "./debts";
import { monthlyCashFlow, monthToDate, sumIncome, sumSpending } from "./cashflow";
import { lastMonths } from "./dates";
import { dailyDriftStats, forecastBalance, safeToSpend } from "./forecast";
import { generateInsights } from "./insights";
import { netWorthSeries } from "./networth";
import { detectRecurring } from "./recurring";
import type { FinanceData } from "./types";

export const FORECAST_DAYS = 60;

export function analyze(data: FinanceData) {
  const { today, transactions: txns } = data;
  const months = lastMonths(today, 13);
  const flows = monthlyCashFlow(txns, months);
  const mtd = monthToDate(today);
  const budgets = budgetStatuses(data.budgets, txns, today);
  // A card's or a loan's payment takes the lender's own date and amount when it states them.
  const streams = withLenderTerms(detectRecurring(txns, today), data.accounts, txns, today);
  const netWorth = netWorthSeries(data.accounts, today);

  const checking =
    data.accounts
      .filter((a) => a.kind === "checking")
      .sort((a, b) => b.balance - a.balance)[0] ?? null;

  let forecast = null;
  let safe = null;
  if (checking) {
    const own = streams.filter((s) => s.accountId === checking.id);
    const recurringIds = new Set(own.flatMap((s) => s.transactionIds));
    forecast = forecastBalance({
      startBalance: checking.balance,
      today,
      horizonDays: FORECAST_DAYS,
      streams: own,
      drift: dailyDriftStats(txns, checking.id, recurringIds, today),
    });
    safe = safeToSpend(checking.balance, today, forecast.events);
  }

  return {
    data,
    today,
    months,
    flows,
    mtd,
    spentMTD: sumSpending(txns, mtd.from, today),
    spentPrevSpan: sumSpending(txns, mtd.prevFrom, mtd.prevTo),
    spentPrevMonth: sumSpending(txns, mtd.prevFrom, mtd.prevMonthEnd),
    incomeMTD: sumIncome(txns, mtd.from, today),
    budgets,
    budgetTotals: budgetTotals(budgets),
    streams,
    checking,
    forecast,
    safe,
    netWorth,
    insights: generateInsights({ txns, today, budgets, streams, flows }),
  };
}

export type Analysis = ReturnType<typeof analyze>;
