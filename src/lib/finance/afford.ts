// src/lib/finance/afford.ts
//
// "Can I afford it?": one purchase, a new monthly payment (a car, a bigger
// rent, a gym) or a raise, tested against what Prism already sees coming.
// Three questions, each answered from figures the person can see elsewhere:
//   1. Does checking stay above the cushion over the next 60 days? (the
//      Future page's forecast, with the scenario's own money added)
//   2. What's safe to spend today, after it? (safeToSpend, the same rule)
//   3. Does what they usually keep each month still cover what their goals
//      ask for? (the last three full months, as the Cash flow page counts)
//
// The forecast is a sum of its events plus a steady drift, so a scenario is
// exact arithmetic on top of it: its own money, added from the day it lands.
// Pure: the Future page's card and the AI connector both call it.

import { addDays, addMonths, monthKey } from "./dates";
import { safeToSpend, type ForecastEvent } from "./forecast";
import { money0, monthLong, shortDate } from "./format";
import type { Analysis } from "./model";
import { projectGoal } from "./networth";
import type { Cents, Goal, ISODate } from "./types";

export type ScenarioKind = "once" | "monthly" | "raise";

/** What's being tried. `amount` is always positive: what it costs, or what more comes in, each time. */
export type Scenario = { kind: ScenarioKind; amount: Cents; date: ISODate };

/** What a scenario is tested against: the Future page's forecast and the person's usual month. */
export type AffordBase = {
  today: ISODate;
  /** Checking now. */
  balance: Cents;
  /** What safe-to-spend keeps back. */
  cushion: Cents;
  /** The forecast, today first, one point a day. */
  points: { date: ISODate; expected: Cents }[];
  /** The paydays and bills the forecast holds. */
  events: ForecastEvent[];
  /** What the person usually keeps a month (income less spending), or null without three full months to tell. */
  monthlyKept: Cents | null;
  goals: Goal[];
};

export type Verdict = {
  answer: "yes" | "tight" | "no";
  /** One sentence that answers the question. */
  headline: string;
  /** Why, in plain words, most important first. */
  reasons: string[];
  lowest: { date: ISODate; balance: Cents };
  lowestBefore: { date: ISODate; balance: Cents };
  safeBefore: Cents;
  safeAfter: Cents;
  keptBefore: Cents | null;
  keptAfter: Cents | null;
  /** What the goals ask for each month. */
  goalsMonthly: Cents;
};

/** The largest amount one scenario may try: past it, the question isn't one Prism can answer from a checking account. */
export const AFFORD_MAX: Cents = 100_000_000;
/** How far ahead a scenario may start: a year. */
export const AFFORD_HORIZON_DAYS = 366;

const fmt = money0;
const day = shortDate;
const monthYear = (d: ISODate) => `${monthLong(d)} ${d.slice(0, 4)}`;

/** A scenario a person typed, or null when it isn't one Prism can try. */
export function validScenario(x: unknown, today: ISODate): Scenario | null {
  if (!x || typeof x !== "object") return null;
  const { kind, amount, date } = x as Record<string, unknown>;
  if (kind !== "once" && kind !== "monthly" && kind !== "raise") return null;
  if (!Number.isInteger(amount) || (amount as number) <= 0 || (amount as number) > AFFORD_MAX) return null;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || addDays(date, 0) !== date) return null;
  if (date < today || date > addDays(today, AFFORD_HORIZON_DAYS)) return null;
  return { kind, amount: amount as number, date };
}

/** The scenario's own money: once, or on the same day each month from its first. */
export function scenarioFlows(s: Scenario, until: ISODate): { date: ISODate; amount: Cents }[] {
  const signed = s.kind === "raise" ? s.amount : -s.amount;
  if (s.kind === "once") return s.date <= until ? [{ date: s.date, amount: signed }] : [];
  const out: { date: ISODate; amount: Cents }[] = [];
  for (let i = 0; ; i++) {
    const d = addMonths(s.date, i);
    if (d > until) return out;
    out.push({ date: d, amount: signed });
  }
}

const lowestOf = (points: { date: ISODate; expected: Cents }[]) =>
  points.reduce((low, p) => (p.expected < low.balance ? { date: p.date, balance: p.expected } : low), { date: points[0]!.date, balance: points[0]!.expected });

export function tryScenario(base: AffordBase, s: Scenario): Verdict {
  const end = base.points.at(-1)!.date;
  const flows = scenarioFlows(s, end);

  // The forecast with the scenario's money added from the day it lands.
  const points = base.points.map((p) => ({ date: p.date, expected: p.expected + flows.reduce((sum, f) => (f.date <= p.date ? sum + f.amount : sum), 0) }));
  const lowestBefore = lowestOf(base.points);
  const lowest = lowestOf(points);

  // Safe to spend, by its own rule: money today comes off the balance, the rest joins the events.
  const today = flows.filter((f) => f.date === base.today).reduce((sum, f) => sum + f.amount, 0);
  const later: ForecastEvent[] = flows
    .filter((f) => f.date > base.today)
    .map((f) => ({ date: f.date, merchant: "What you're trying", amount: f.amount, kind: s.kind === "raise" ? "income" : "bill", variable: false }));
  // A raise lands on its own day, never as the "next paycheck" safe-to-spend measures up to.
  const events = [...base.events, ...(s.kind === "raise" ? [] : later)].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.amount - b.amount));
  const safeBefore = safeToSpend(base.balance, base.today, base.events, base.cushion).amount;
  const safeAfter = safeToSpend(base.balance + today, base.today, events, base.cushion).amount;

  const keptBefore = base.monthlyKept;
  const keptAfter = keptBefore === null || s.kind === "once" ? keptBefore : keptBefore + (s.kind === "raise" ? s.amount : -s.amount);
  const goalsMonthly = base.goals.reduce((sum, g) => sum + Math.max(0, g.monthlyContribution), 0);

  const reasons: string[] = [];
  const dips = lowest.balance < 0;
  const thin = lowest.balance < base.cushion;
  const goalsFitBefore = keptBefore !== null && keptBefore >= goalsMonthly;
  const goalsFitAfter = keptAfter !== null && keptAfter >= goalsMonthly;

  if (s.kind === "raise") {
    reasons.push(keptAfter === null ? `That's ${fmt(s.amount)} more each month.` : `You'd usually keep about ${fmt(keptAfter)} a month, up from ${fmt(keptBefore!)}.`);
    const behind = base.goals.map((g) => ({ g, now: projectGoal(g, base.today), then: projectGoal(g, base.today, g.monthlyContribution + s.amount) })).filter((x) => x.now.remaining > 0);
    // The goal that gains the most: the furthest behind.
    const pick = behind.sort((a, b) => Number(a.now.onTrack) - Number(b.now.onTrack) || (b.now.monthsToGo ?? Infinity) - (a.now.monthsToGo ?? Infinity))[0];
    if (pick && pick.then.projectedDate) {
      const sooner = pick.now.monthsToGo === null ? null : pick.now.monthsToGo - pick.then.monthsToGo!;
      reasons.push(`Put into ${pick.g.name}, it would be done by ${monthYear(pick.then.projectedDate)}${sooner ? `, ${sooner} ${sooner === 1 ? "month" : "months"} sooner` : ""}.`);
    }
    return { answer: "yes", headline: `That's ${fmt(s.amount)} more a month to plan with.`, reasons, lowest, lowestBefore, safeBefore, safeAfter, keptBefore, keptAfter, goalsMonthly };
  }

  if (dips) reasons.push(`Checking would drop to ${fmt(lowest.balance)} around ${day(lowest.date)}, below zero.`);
  else if (thin) reasons.push(`Checking would get down to ${fmt(lowest.balance)} around ${day(lowest.date)}, under the ${fmt(base.cushion)} cushion.`);
  else reasons.push(`Checking would stay above ${fmt(lowest.balance)}, its lowest around ${day(lowest.date)}.`);

  if (s.kind === "monthly" && keptAfter !== null) {
    if (keptAfter < 0) reasons.push(`Each month you'd spend about ${fmt(-keptAfter)} more than comes in.`);
    else if (goalsMonthly > 0 && !goalsFitAfter)
      reasons.push(
        goalsFitBefore
          ? `Your goals ask for ${fmt(goalsMonthly)} a month; you'd usually keep about ${fmt(keptAfter)}.`
          : `Your goals already ask for more than you usually keep (${fmt(goalsMonthly)} against ${fmt(keptBefore!)}); this would leave about ${fmt(keptAfter)}.`,
      );
    else reasons.push(`You'd still usually keep about ${fmt(keptAfter)} a month${goalsMonthly > 0 ? `, enough for your goals' ${fmt(goalsMonthly)}` : ""}.`);
  }
  if (s.kind === "once" && keptBefore !== null && keptBefore > 0) {
    const months = s.amount / keptBefore;
    reasons.push(months < 1 ? `It's less than one month of what you usually keep (${fmt(keptBefore)}).` : `It's about ${months < 10 ? months.toFixed(1).replace(/\.0$/, "") : Math.round(months)} months of what you usually keep (${fmt(keptBefore)} a month).`);
  }
  if (s.date > end) reasons.push("It starts after the 60 days the forecast covers, so checking is shown as it stands.");

  const unsustainable = s.kind === "monthly" && keptAfter !== null && keptAfter < 0;
  // Goals it would crowd out, or goals already short that it would leave shorter still.
  const crowds = s.kind === "monthly" && keptAfter !== null && !goalsFitAfter;
  const answer: Verdict["answer"] = dips || unsustainable ? "no" : thin || crowds ? "tight" : "yes";
  const headline =
    answer === "yes"
      ? "Yes, it fits."
      : answer === "tight"
        ? "It fits, but it's tight."
        : dips
          ? "Not yet: checking would run out."
          : "Not as things stand: it costs more than you usually keep.";
  return { answer, headline, reasons, lowest, lowestBefore, safeBefore, safeAfter, keptBefore, keptAfter, goalsMonthly };
}

/** What the person usually keeps a month: income less spending over the last three full months, or null without them. */
export function usualMonthlyKept(flows: { month: string; net: Cents }[], today: ISODate, firstRecord: ISODate | null): Cents | null {
  const thisMonth = monthKey(today);
  // Only months Prism saw from their first day.
  const full = flows.filter((f) => f.month < thisMonth && firstRecord !== null && `${f.month}-01` >= firstRecord).slice(-3);
  if (full.length < 3) return null;
  return Math.round(full.reduce((s, f) => s + f.net, 0) / 3);
}

/** What a scenario is tested against, from the same analysis the Future page draws; null without a checking account to forecast. */
export function affordBase(a: Analysis): AffordBase | null {
  if (!a.forecast || !a.safe || !a.checking) return null;
  const first = a.data.transactions.reduce<ISODate | null>((min, t) => (t.date <= a.today && (min === null || t.date < min) ? t.date : min), null);
  return {
    today: a.today,
    balance: a.checking.balance,
    cushion: a.safe.cushion,
    points: a.forecast.points.map((p) => ({ date: p.date, expected: p.expected })),
    events: a.forecast.events,
    monthlyKept: usualMonthlyKept(a.flows, a.today, first),
    goals: a.data.goals,
  };
}
