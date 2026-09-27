// src/lib/finance/forecast.ts
//
// The forward view: where the checking balance is heading, day by day, and
// how much is genuinely safe to spend before the next paycheck. Budgeting apps
// mostly look backwards; this is the screen that looks ahead.
//
// Model, deliberately simple enough to explain in one sentence to a customer:
//   tomorrow = today + scheduled bills and paychecks + your usual day-to-day
// The "usual day-to-day" is the average of the account's NON-recurring flows
// over the last 90 days, and the band around the line widens with the square
// root of time (that same daily flow's spread) plus the wobble of the variable
// bills — the electric bill is a guess, rent is not.

import { addDays, daysBetween, eachDay } from "./dates";
import { occurrences, type RecurringStream } from "./recurring";
import type { Cents, ISODate, Transaction } from "./types";

export type ForecastEvent = {
  date: ISODate;
  merchant: string;
  amount: Cents;
  kind: RecurringStream["kind"];
  variable: boolean;
};

export type ForecastPoint = {
  date: ISODate;
  expected: Cents;
  low: Cents;
  high: Cents;
};

export type Forecast = {
  points: ForecastPoint[];
  events: ForecastEvent[];
  /** The lowest expected balance in the window and the day it happens. */
  lowest: { date: ISODate; balance: Cents };
  /** Average daily non-recurring flow used for the drift (usually negative). */
  dailyDrift: Cents;
};

const HISTORY_DAYS = 90;
/** z for an 80% band — wide enough to be honest, narrow enough to be useful. */
const Z80 = 1.2816;

export function dailyDriftStats(
  txns: Transaction[],
  accountId: string,
  recurringIds: Set<string>,
  today: ISODate,
): { mean: number; std: number } {
  const from = addDays(today, -HISTORY_DAYS);
  const perDay = new Map(eachDay(from, addDays(today, -1)).map((d) => [d, 0]));
  for (const t of txns) {
    if (t.accountId !== accountId || recurringIds.has(t.id) || !perDay.has(t.date)) continue;
    perDay.set(t.date, perDay.get(t.date)! + t.amount);
  }
  const xs = [...perDay.values()];
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, xs.length - 1);
  return { mean, std: Math.sqrt(variance) };
}

export function forecastBalance(opts: {
  startBalance: Cents;
  today: ISODate;
  horizonDays: number;
  streams: RecurringStream[];
  drift: { mean: number; std: number };
}): Forecast {
  const { startBalance, today, horizonDays, streams, drift } = opts;
  const end = addDays(today, horizonDays);
  const tomorrow = addDays(today, 1);

  const events: ForecastEvent[] = streams
    .flatMap((s) =>
      occurrences(s, tomorrow, end).map((date) => ({
        date,
        merchant: s.merchant,
        amount: s.amount,
        kind: s.kind,
        variable: s.variable,
      })),
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.amount - b.amount));

  const points: ForecastPoint[] = [{ date: today, expected: startBalance, low: startBalance, high: startBalance }];
  let balance = startBalance;
  let variableVar = 0;
  let lowest = { date: today, balance: startBalance };
  let i = 0;
  for (let d = tomorrow; d <= end; d = addDays(d, 1)) {
    balance += drift.mean;
    for (; i < events.length && events[i]!.date === d; i++) {
      const e = events[i]!;
      balance += e.amount;
      // A variable bill carries ±15% (as one σ) of its own size.
      if (e.variable) variableVar += (0.15 * e.amount) ** 2;
    }
    const t = daysBetween(today, d);
    const spread = Z80 * Math.sqrt(drift.std ** 2 * t + variableVar);
    const expected = Math.round(balance);
    points.push({ date: d, expected, low: Math.round(balance - spread), high: Math.round(balance + spread) });
    if (expected < lowest.balance) lowest = { date: d, balance: expected };
  }
  return { points, events, lowest, dailyDrift: Math.round(drift.mean) };
}

export type SafeToSpend = {
  amount: Cents;
  /** The next paycheck the amount is measured up to, if one is scheduled. */
  until: ISODate | null;
  /** Scheduled money out between now and then. */
  committed: Cents;
  cushion: Cents;
};

/**
 * What can be spent today without the balance dipping below the cushion
 * before the next paycheck lands — counting every scheduled bill in between,
 * and nothing speculative.
 */
export function safeToSpend(
  startBalance: Cents,
  today: ISODate,
  events: ForecastEvent[],
  cushion: Cents = 25_000,
): SafeToSpend {
  const payday = events.find((e) => e.kind === "income" && e.amount > 0 && e.date > today)?.date ?? null;
  const horizon = payday ?? addDays(today, 14);
  let balance = startBalance;
  let low = startBalance;
  let committed = 0;
  for (const e of events) {
    if (e.date > horizon) break;
    // Stop at the paycheck. Events sort outflows first within a day, so a bill
    // due ON payday is still counted — the conservative reading.
    if (e.date === payday && e.amount > 0) break;
    balance += e.amount;
    if (e.amount < 0) committed -= e.amount;
    low = Math.min(low, balance);
  }
  return { amount: Math.max(0, low - cushion), until: payday, committed, cushion };
}
