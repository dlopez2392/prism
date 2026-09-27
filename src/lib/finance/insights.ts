// src/lib/finance/insights.ts
//
// Plain-language insights that SHOW THEIR WORK. Surveys in 2026 put daily AI
// use for money questions near one in five Americans but "trust a great deal"
// in the single digits; the gap is evidence. So every insight here is a rule
// over the person's own transactions, carries the exact transactions it was
// computed from, and the UI puts them one tap away (DESIGN.md rule 7).
//
// Nothing here is advice. It is arithmetic, phrased kindly.

import { categoryBreakdown, monthToDate, type MonthFlow } from "./cashflow";
import { CATEGORIES } from "./categories";
import type { BudgetStatus } from "./budgets";
import { daysLeftInMonth } from "./budgets";
import { addDays, monthKey, startOfMonth } from "./dates";
import { money, money0, monthLong, percent } from "./format";
import { monthlyCost, type RecurringStream } from "./recurring";
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
}): Insight[] {
  const { txns, today, budgets, streams, flows } = input;
  const out: Insight[] = [];
  const mtd = monthToDate(today);
  const inMonth = (t: Transaction, c: string) => t.category === c && t.date >= mtd.from && t.date <= today;

  // 1. Budgets that are over, or on pace to be.
  const worst = budgets
    .filter((b) => b.state !== "on_track")
    .sort((a, b) => b.projected - b.limit - (a.projected - a.limit))[0];
  if (worst) {
    const label = CATEGORIES[worst.category].label;
    const ids = txns.filter((t) => inMonth(t, worst.category)).map((t) => t.id);
    const left = daysLeftInMonth(today);
    out.push(
      worst.state === "over"
        ? {
            id: `budget-over-${worst.category}`,
            tone: "heads_up",
            title: `${label} is ${money0(worst.spent - worst.limit)} over budget`,
            detail: `${money0(worst.spent)} spent against ${money0(worst.limit)}, with ${left} ${left === 1 ? "day" : "days"} to go.`,
            evidence: ids,
            evidenceLabel: `${ids.length} ${label.toLowerCase()} transactions this month`,
          }
        : {
            id: `budget-risk-${worst.category}`,
            tone: "heads_up",
            title: `${label} is on pace to go ${money0(worst.projected - worst.limit)} over`,
            detail: `${money0(worst.spent)} of ${money0(worst.limit)} spent. At your usual pace you'll reach about ${money0(worst.projected)} by month end.`,
            evidence: ids,
            evidenceLabel: `${ids.length} ${label.toLowerCase()} transactions this month`,
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
        title: `Your paycheck went up ${percent(pct, 1)}`,
        detail: `${money(to - from)} more every payday — about ${money0(((to - from) * 26))} a year. Nice.`,
        evidence: s.transactionIds.slice(-4),
        evidenceLabel: "Your last four paychecks",
      });
    } else if (s.amount < 0 && Math.abs(to) > Math.abs(from)) {
      const yearly = (Math.abs(to) - Math.abs(from)) * 12;
      out.push({
        id: `price-${s.id}`,
        tone: "heads_up",
        title: `${s.merchant} raised its price to ${money(Math.abs(to))}`,
        detail: `It was ${money(Math.abs(from))}. That's ${money0(yearly)} more a year — worth a look if you don't use it much.`,
        evidence: s.transactionIds.slice(-4),
        evidenceLabel: `Your last ${Math.min(4, s.transactionIds.length)} ${s.merchant} charges`,
      });
    }
  }

  // 3. The category that moved most against the same days last month.
  const rows = categoryBreakdown(txns, { from: mtd.from, to: today }, { from: mtd.prevFrom, to: mtd.prevTo });
  const mover = rows
    .filter((r) => r.change !== null && Math.abs(r.amount - r.previous) >= 4_000 && Math.abs(r.change) >= 0.15)
    .sort((a, b) => Math.abs(b.amount - b.previous) - Math.abs(a.amount - a.previous))[0];
  if (mover && mover.change !== null) {
    const label = CATEGORIES[mover.category].label;
    const down = mover.change < 0;
    const prevMonth = monthLong(mtd.prevFrom);
    const ids = txns.filter((t) => inMonth(t, mover.category)).map((t) => t.id);
    out.push({
      id: `mover-${mover.category}`,
      tone: down ? "win" : "idea",
      title: `${label} is ${down ? "down" : "up"} ${percent(Math.abs(mover.change))} on ${prevMonth}`,
      detail: `${money0(mover.amount)} so far this month, against ${money0(mover.previous)} by this point in ${prevMonth}.`,
      evidence: ids,
      evidenceLabel: `${ids.length} ${label.toLowerCase()} transactions this month`,
    });
  }

  // 4. Last full month's savings rate against the six before it.
  const full = flows.filter((f) => f.month < monthKey(today) && f.savingsRate !== null);
  const last = full.at(-1);
  const prior = full.slice(-7, -1);
  if (last && last.savingsRate !== null && prior.length >= 3) {
    const avg = prior.reduce((s, f) => s + (f.savingsRate ?? 0), 0) / prior.length;
    const monthStart = `${last.month}-01`;
    const ids = txns
      .filter((t) => monthKey(t.date) === last.month && t.category === "income")
      .map((t) => t.id);
    if (last.savingsRate > avg + 0.02) {
      out.push({
        id: "savings-rate",
        tone: "win",
        title: `You kept ${percent(last.savingsRate)} of your income in ${monthLong(monthStart)}`,
        detail: `Your six-month average is ${percent(avg)}. That month put ${money0(last.net)} to work.`,
        evidence: ids,
        evidenceLabel: `Income received in ${monthLong(monthStart)}`,
      });
    } else if (last.savingsRate < avg - 0.05) {
      out.push({
        id: "savings-rate",
        tone: "idea",
        title: `${monthLong(monthStart)} was a spendier month`,
        detail: `You kept ${percent(Math.max(0, last.savingsRate))} of your income, against a six-month average of ${percent(avg)}.`,
        evidence: ids,
        evidenceLabel: `Income received in ${monthLong(monthStart)}`,
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
      title: `${subs.length} subscriptions cost you ${money0(monthly * 12)} a year`,
      detail: `That's ${money0(monthly)} a month. See them all on the Future tab.`,
      evidence: subs.flatMap((s) => s.transactionIds.slice(-1)),
      evidenceLabel: "The latest charge from each subscription",
    });
  }

  // 6. A one-off purchase well above the usual for its category.
  const scheduled = new Set(streams.flatMap((s) => s.transactionIds));
  const recent = txns.filter(
    (t) => t.amount < -20_000 && t.date > addDays(today, -14) && CATEGORIES[t.category].slot > 0 && !scheduled.has(t.id),
  );
  for (const t of recent.sort((a, b) => a.amount - b.amount).slice(0, 1)) {
    const sameCat = txns
      .filter((x) => x.category === t.category && x.amount < 0 && x.date >= addDays(startOfMonth(today), -90))
      .map((x) => -x.amount)
      .sort((a, b) => a - b);
    const med = sameCat[Math.floor(sameCat.length / 2)] ?? 0;
    if (med > 0 && -t.amount > med * 3) {
      out.push({
        id: `oneoff-${t.id}`,
        tone: "idea",
        title: `A bigger one: ${money(-t.amount)} at ${t.merchant}`,
        detail: `About ${Math.round(-t.amount / med)}× your typical ${CATEGORIES[t.category].label.toLowerCase()} purchase. Just flagging it — no judgement.`,
        evidence: [t.id],
        evidenceLabel: "The purchase",
      });
    }
  }

  return out.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}
