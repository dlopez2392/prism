// src/lib/finance/alert-snapshot.ts
//
// What a person's visit leaves for the alert email job, which can't read
// their money itself: the alerts the visit found (alerts.ts), the week's
// numbers for a Monday summary, and the next two weeks' bills. Sealed with
// the vault key before it's stored, and kept only while their alert emails
// are on (profiles.sealed_alerts). Every email says when this was taken.
//
// Pure: built from the analysis, checked again when it's opened.

import { alertsFor, type Alert, type AlertKind } from "./alerts";
import { addDays } from "./dates";
import { sumSpending } from "./cashflow";
import type { Analysis } from "./model";
import type { Cents, ISODate } from "./types";

export type WeeklyNumbers = {
  /** The seven days before the visit's day. */
  from: ISODate;
  to: ISODate;
  spent: Cents;
  /** The seven days before those. */
  spentBefore: Cents;
  /** This month's budgets so far, when there are any. */
  month: { spent: Cents; limit: Cents } | null;
  netWorth: Cents;
  /** At the end of last month, when there's a month to compare with. */
  netWorthLastMonth: Cents | null;
};

/** A bill or payment coming out of the account the forecast follows. */
export type Upcoming = { name: string; date: ISODate; amount: Cents };

export type AlertSnapshot = {
  v: 1;
  /** When the visit took it (ISO time). */
  at: string;
  /** The visit's own day. */
  today: ISODate;
  /** Bills short and price rises: a bank's warnings come fresher from the database itself. */
  alerts: Alert[];
  weekly: WeeklyNumbers;
  /** What the forecast has going out in the next two weeks; null when there's no forecast to ask. */
  upcoming: Upcoming[] | null;
};

const UPCOMING_DAYS = 14;
const MAX_UPCOMING = 20;
const MAX_ALERTS = 20;

export function alertSnapshot(a: Analysis, at: string): AlertSnapshot {
  const txns = a.data.transactions;
  const t = a.today;
  const nw = a.netWorth;
  return {
    v: 1,
    at,
    today: t,
    alerts: alertsFor(a)
      .filter((x) => x.kind !== "bank")
      .slice(0, MAX_ALERTS),
    weekly: {
      from: addDays(t, -7),
      to: addDays(t, -1),
      spent: sumSpending(txns, addDays(t, -7), addDays(t, -1)),
      spentBefore: sumSpending(txns, addDays(t, -14), addDays(t, -8)),
      month: a.budgetTotals.limit > 0 ? { spent: a.budgetTotals.spent, limit: a.budgetTotals.limit } : null,
      netWorth: nw.at(-1)?.net ?? 0,
      netWorthLastMonth: nw.length >= 2 ? nw.at(-2)!.net : null,
    },
    upcoming: a.forecast
      ? a.forecast.events
          .filter((e) => e.amount < 0 && e.date <= addDays(t, UPCOMING_DAYS))
          .slice(0, MAX_UPCOMING)
          .map((e) => ({ name: e.merchant, date: e.date, amount: -e.amount }))
      : null,
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: AlertKind[] = ["bank", "bill-short", "price-rise"];
const text = (x: unknown, max: number): x is string => typeof x === "string" && x.length <= max;
const cents = (x: unknown): x is Cents => Number.isSafeInteger(x);

function validAlert(x: unknown): Alert | null {
  const a = x as Partial<Alert> | null;
  if (!a || !text(a.id, 300) || !KINDS.includes(a.kind as AlertKind) || !text(a.title, 300) || !text(a.detail, 1000) || !text(a.href, 100)) return null;
  if (!a.quiet || !text(a.quiet.title, 300) || !text(a.quiet.detail, 1000) || typeof a.urgent !== "boolean") return null;
  if (a.on !== null && !(typeof a.on === "string" && DAY.test(a.on))) return null;
  return { id: a.id, kind: a.kind!, title: a.title, detail: a.detail, quiet: { title: a.quiet.title, detail: a.quiet.detail }, on: a.on ?? null, href: a.href, urgent: a.urgent };
}

/** A stored snapshot, opened: only what reads as one survives. */
export function validSnapshot(x: unknown): AlertSnapshot | null {
  const s = x as Partial<AlertSnapshot> | null;
  if (!s || s.v !== 1 || !text(s.at, 40) || !Number.isFinite(Date.parse(s.at)) || !text(s.today, 10) || !DAY.test(s.today)) return null;
  const w = s.weekly as Partial<WeeklyNumbers> | undefined;
  if (!w || !text(w.from, 10) || !text(w.to, 10) || !cents(w.spent) || !cents(w.spentBefore) || !cents(w.netWorth)) return null;
  if (w.netWorthLastMonth !== null && !cents(w.netWorthLastMonth)) return null;
  if (w.month !== null && !(w.month && cents(w.month.spent) && cents(w.month.limit))) return null;
  if (!Array.isArray(s.alerts) || s.alerts.length > MAX_ALERTS) return null;
  if (s.upcoming !== null && !(Array.isArray(s.upcoming) && s.upcoming.length <= MAX_UPCOMING)) return null;
  const alerts = s.alerts.map(validAlert);
  if (alerts.some((a) => a === null)) return null;
  const upcoming = s.upcoming?.filter((u): u is Upcoming => !!u && text(u.name, 200) && typeof u.date === "string" && DAY.test(u.date) && cents(u.amount)) ?? null;
  return {
    v: 1,
    at: s.at,
    today: s.today,
    alerts: alerts as Alert[],
    weekly: { from: w.from, to: w.to, spent: w.spent, spentBefore: w.spentBefore, month: w.month ? { spent: w.month.spent, limit: w.month.limit } : null, netWorth: w.netWorth, netWorthLastMonth: w.netWorthLastMonth ?? null },
    upcoming: upcoming?.map((u) => ({ name: u.name, date: u.date, amount: u.amount })) ?? null,
  };
}
