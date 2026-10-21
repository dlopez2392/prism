// src/lib/finance/payday.ts
//
// The payday plan: the latest paycheck, given a job for every dollar until
// the next one. What came in, the bills and subscriptions that come out
// before the next payday (already paid, and still to come), what the goals
// ask for over the same days, and what's left to live on: how much of it is
// spent so far, and what that leaves a day. Prism moves no money: this is the
// plan, laid out, for the person to follow.
//
// It's built from what the screens already know (recurring.ts for the bills,
// income.ts for the paychecks, the goals' monthly amounts), so it agrees with
// Future. Card payments aren't a bill here: what they pay for is the card
// spending already counted day to day. Day-to-day is every spending line
// since payday that isn't one of the bills, on any account.
//
// Pure: reads the analysis.

import { isSpending } from "./cashflow";
import { addDays, daysBetween } from "./dates";
import { paychecks } from "./income";
import { occurrences, type RecurringStream } from "./recurring";
import type { Cents, FinanceData, ISODate } from "./types";

export type PaydayPlan = {
  /** The last payday, and the next: the plan covers the days from one to the day before the other. */
  payday: ISODate;
  nextPayday: ISODate;
  /** What landed on payday, from every paycheck that came that day. */
  paycheck: Cents;
  payers: string[];
  /** Each bill in the period, soonest first: what it costs and whether it's paid yet. */
  bills: { name: string; date: ISODate; amount: Cents; paid: boolean }[];
  billsTotal: Cents;
  /** Each goal's share of the period, from its monthly amount. */
  goals: { name: string; amount: Cents }[];
  goalsTotal: Cents;
  /** The paycheck less bills and goals: what's planned to live on. Below zero, they come to more than the paycheck. */
  toLiveOn: Cents;
  /** Day-to-day spending since payday. */
  spent: Cents;
  /** What's left to live on, and what that is a day until the next payday (today included). */
  left: Cents;
  daysLeft: number;
  perDay: Cents;
};

const DAYS_A_MONTH = 30.44;

export function paydayPlan(data: Pick<FinanceData, "transactions" | "goals" | "today">, streams: RecurringStream[]): PaydayPlan | null {
  const { transactions: txns, today } = data;
  const pay = paychecks(streams, txns);
  if (!pay.length) return null;
  const payday = pay.reduce<ISODate>((d, p) => (p.lastDate > d ? p.lastDate : d), pay[0]!.lastDate);
  const nextPayday = pay.map((p) => p.next).filter((d) => d > today).sort()[0];
  if (!nextPayday || payday > today) return null;
  const byId = new Map(txns.map((t) => [t.id, t]));
  const landed = pay.filter((p) => p.lastDate === payday);
  const paycheck = landed.reduce((s, p) => s + (byId.get(p.transactionIds.at(-1)!)?.amount ?? p.takeHome), 0);

  const end = addDays(nextPayday, -1);
  const bills: PaydayPlan["bills"] = [];
  const billLines = new Set<string>();
  for (const s of streams) {
    if (s.amount >= 0 || s.kind === "income" || s.kind === "transfer") continue;
    // Already paid since payday.
    for (const id of s.transactionIds) {
      const t = byId.get(id);
      if (t && t.date >= payday && t.date <= today) {
        bills.push({ name: s.merchant, date: t.date, amount: -t.amount, paid: true });
        billLines.add(id);
      }
    }
    // Still to come before the next payday.
    for (const d of occurrences(s, addDays(today, 1), end)) bills.push({ name: s.merchant, date: d, amount: -s.amount, paid: false });
  }
  bills.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount));
  const billsTotal = bills.reduce((s, b) => s + b.amount, 0);

  const days = daysBetween(payday, nextPayday);
  const goals = data.goals
    .filter((g) => g.monthlyContribution > 0 && g.saved < g.target)
    .map((g) => ({ name: g.name, amount: Math.round((g.monthlyContribution * days) / DAYS_A_MONTH) }));
  const goalsTotal = goals.reduce((s, g) => s + g.amount, 0);

  const toLiveOn = paycheck - billsTotal - goalsTotal;
  const spent = txns.filter((t) => t.date >= payday && t.date <= today && !t.pending && isSpending(t) && t.amount < 0 && !billLines.has(t.split?.of ?? t.id)).reduce((s, t) => s - t.amount, 0);
  const left = toLiveOn - spent;
  const daysLeft = Math.max(1, daysBetween(today, nextPayday));
  return {
    payday,
    nextPayday,
    paycheck,
    payers: landed.map((p) => p.payer),
    bills,
    billsTotal,
    goals,
    goalsTotal,
    toLiveOn,
    spent,
    left,
    daysLeft,
    perDay: left > 0 ? Math.floor(left / daysLeft) : 0,
  };
}
