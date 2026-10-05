// src/lib/finance/insights.ts
//
// Plain-language insights that SHOW THEIR WORK. Surveys in 2026 put daily AI
// use for money questions near one in five Americans but "trust a great deal"
// in the single digits; the gap is evidence. So every insight here is a rule
// over the person's own transactions, carries the exact transactions it was
// computed from, and the UI puts them one tap away (DESIGN.md rule 7).
//
// Nothing here is advice. It is arithmetic, phrased kindly.

import { categoryBreakdown, isIncome, monthToDate, type MonthFlow } from "./cashflow";
import { EN, type T } from "@/lib/i18n/t";
import { CATEGORIES, categoryLabel } from "./categories";
import type { BudgetStatus } from "./budgets";
import { daysLeftInMonth } from "./budgets";
import { addDays, monthKey, startOfMonth } from "./dates";
import { money, money0, monthLong, percent } from "./format";
import { monthlyCost, perYear, type RecurringStream } from "./recurring";
import type { ISODate, Transaction } from "./types";

export type InsightTone = "heads_up" | "win" | "idea";

export type Insight = {
  id: string;
  tone: InsightTone;
  title: string;
  detail: string;
  /** The transactions this insight was computed from. */
  evidence: string[];
  evidenceLabel: string;
};

const TONE_ORDER: Record<InsightTone, number> = { heads_up: 0, win: 1, idea: 2 };

export function generateInsights(input: {
  txns: Transaction[];
  today: ISODate;
  budgets: BudgetStatus[];
  streams: RecurringStream[];
  flows: MonthFlow[];
  /** The language to say it in; English unless asked. */
  t?: T;
}): Insight[] {
  const { txns, today, budgets, streams, flows, t = EN } = input;
  const { locale } = t;
  const inCategory = (n: number, label: string) =>
    n === 1 ? t("1 {category} transaction this month", { category: label.toLowerCase() }) : t("{n} {category} transactions this month", { n, category: label.toLowerCase() });
  const out: Insight[] = [];
  const mtd = monthToDate(today);
  const inMonth = (x: Transaction, c: string) => x.category === c && !x.excluded && x.date >= mtd.from && x.date <= today;

  // 1. Budgets that are over, or on pace to be.
  const worst = budgets
    .filter((b) => b.state !== "on_track")
    .sort((a, b) => b.projected - b.limit - (a.projected - a.limit))[0];
  if (worst) {
    const label = categoryLabel(worst.category, t);
    const ids = txns.filter((x) => inMonth(x, worst.category)).map((x) => x.id);
    const left = daysLeftInMonth(today);
    out.push(
      worst.state === "over"
        ? {
            id: `budget-over-${worst.category}`,
            tone: "heads_up",
            title: t("{category} is {amount} over budget", { category: label, amount: money0(worst.spent - worst.limit) }),
            detail:
              left === 1
                ? t("{spent} spent against {limit}, with 1 day to go.", { spent: money0(worst.spent), limit: money0(worst.limit) })
                : t("{spent} spent against {limit}, with {n} days to go.", { spent: money0(worst.spent), limit: money0(worst.limit), n: left }),
            evidence: ids,
            evidenceLabel: inCategory(ids.length, label),
          }
        : {
            id: `budget-risk-${worst.category}`,
            tone: "heads_up",
            title: t("{category} is on pace to go {amount} over", { category: label, amount: money0(worst.projected - worst.limit) }),
            detail: t("{spent} of {limit} spent. At your usual pace you'll reach about {projected} by month end.", {
              spent: money0(worst.spent),
              limit: money0(worst.limit),
              projected: money0(worst.projected),
            }),
            evidence: ids,
            evidenceLabel: inCategory(ids.length, label),
          },
    );
  }

  // 2. A fixed charge that changed price.
  for (const s of streams) {
    if (!s.priceChange || s.kind === "transfer") continue;
    const { from, to } = s.priceChange;
    if (s.kind === "income" && to > from) {
      const pct = (to - from) / from;
      out.push({
        id: `raise-${s.id}`,
        tone: "win",
        title: t("Your paycheck went up {pct}", { pct: percent(pct, 1) }),
        detail: t("{amount} more every payday — about {yearly} a year. Nice.", { amount: money(to - from), yearly: money0((to - from) * perYear(s.cadence)) }),
        evidence: s.transactionIds.slice(-4),
        evidenceLabel: t("Your last four paychecks"),
      });
    } else if (s.amount < 0 && Math.abs(to) > Math.abs(from)) {
      const yearly = (Math.abs(to) - Math.abs(from)) * perYear(s.cadence);
      out.push({
        id: `price-${s.id}`,
        tone: "heads_up",
        title: t("{merchant} raised its price to {amount}", { merchant: s.merchant, amount: money(Math.abs(to)) }),
        detail: t("It was {before}. That's {yearly} more a year — worth a look if you don't use it much.", { before: money(Math.abs(from)), yearly: money0(yearly) }),
        evidence: s.transactionIds.slice(-4),
        evidenceLabel: t("Your last {n} {merchant} charges", { n: Math.min(4, s.transactionIds.length), merchant: s.merchant }),
      });
    }
  }

  // 3. The category that moved most against the same days last month.
  const rows = categoryBreakdown(txns, { from: mtd.from, to: today }, { from: mtd.prevFrom, to: mtd.prevTo });
  const mover = rows
    .filter((r) => r.change !== null && Math.abs(r.amount - r.previous) >= 4_000 && Math.abs(r.change) >= 0.15)
    .sort((a, b) => Math.abs(b.amount - b.previous) - Math.abs(a.amount - a.previous))[0];
  if (mover && mover.change !== null) {
    const label = categoryLabel(mover.category, t);
    const down = mover.change < 0;
    const prevMonth = monthLong(mtd.prevFrom, locale);
    const ids = txns.filter((x) => inMonth(x, mover.category)).map((x) => x.id);
    out.push({
      id: `mover-${mover.category}`,
      tone: down ? "win" : "idea",
      title: (down ? t("{category} is down {pct} on {month}", { category: label, pct: percent(Math.abs(mover.change)), month: prevMonth }) : t("{category} is up {pct} on {month}", { category: label, pct: percent(Math.abs(mover.change)), month: prevMonth })),
      detail: t("{amount} so far this month, against {before} by this point in {month}.", { amount: money0(mover.amount), before: money0(mover.previous), month: prevMonth }),
      evidence: ids,
      evidenceLabel: inCategory(ids.length, label),
    });
  }

  // 4. Last full month's savings rate against the six before it.
  const full = flows.filter((f) => f.month < monthKey(today) && f.savingsRate !== null);
  const last = full.at(-1);
  const prior = full.slice(-7, -1);
  if (last && last.savingsRate !== null && prior.length >= 3) {
    const avg = prior.reduce((s, f) => s + (f.savingsRate ?? 0), 0) / prior.length;
    const monthStart = `${last.month}-01`;
    const month = monthLong(monthStart, locale);
    const ids = txns
      .filter((x) => monthKey(x.date) === last.month && isIncome(x))
      .map((x) => x.id);
    if (last.savingsRate > avg + 0.02) {
      out.push({
        id: "savings-rate",
        tone: "win",
        title: t("You kept {pct} of your income in {month}", { pct: percent(last.savingsRate), month }),
        detail: t("Your six-month average is {pct}. That month put {amount} to work.", { pct: percent(avg), amount: money0(last.net) }),
        evidence: ids,
        evidenceLabel: t("Income received in {month}", { month }),
      });
    } else if (last.savingsRate < avg - 0.05) {
      out.push({
        id: "savings-rate",
        tone: "idea",
        title: t("{month} was a spendier month", { month }),
        detail: t("You kept {pct} of your income, against a six-month average of {avg}.", { pct: percent(Math.max(0, last.savingsRate)), avg: percent(avg) }),
        evidence: ids,
        evidenceLabel: t("Income received in {month}", { month }),
      });
    }
  }

  // 5. What subscriptions add up to.
  const subs = streams.filter((s) => s.kind === "subscription" && s.amount < 0);
  if (subs.length >= 3) {
    const monthly = subs.reduce((s, x) => s + monthlyCost(x), 0);
    out.push({
      id: "subscriptions",
      tone: "idea",
      title: t("{n} subscriptions cost you {yearly} a year", { n: subs.length, yearly: money0(monthly * 12) }),
      detail: t("That's {monthly} a month. See them all on the Future tab.", { monthly: money0(monthly) }),
      evidence: subs.flatMap((s) => s.transactionIds.slice(-1)),
      evidenceLabel: t("The latest charge from each subscription"),
    });
  }

  // 6. A one-off purchase well above the usual for its category.
  const scheduled = new Set(streams.flatMap((s) => s.transactionIds));
  const recent = txns.filter(
    (x) => x.amount < -20_000 && !x.excluded && x.date > addDays(today, -14) && CATEGORIES[x.category].slot > 0 && !scheduled.has(x.split?.of ?? x.id),
  );
  for (const big of recent.sort((a, b) => a.amount - b.amount).slice(0, 1)) {
    const sameCat = txns
      .filter((x) => x.category === big.category && !x.excluded && x.amount < 0 && x.date >= addDays(startOfMonth(today), -90))
      .map((x) => -x.amount)
      .sort((a, b) => a - b);
    const med = sameCat[Math.floor(sameCat.length / 2)] ?? 0;
    if (med > 0 && -big.amount > med * 3) {
      out.push({
        id: `oneoff-${big.id}`,
        tone: "idea",
        title: t("A bigger one: {amount} at {merchant}", { amount: money(-big.amount), merchant: big.merchant }),
        detail: t("About {times}× your typical {category} purchase. Just flagging it — no judgement.", { times: Math.round(-big.amount / med), category: categoryLabel(big.category, t).toLowerCase() }),
        evidence: [big.id],
        evidenceLabel: t("The purchase"),
      });
    }
  }

  return out.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}
