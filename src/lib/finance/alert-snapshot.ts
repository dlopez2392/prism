// src/lib/finance/alert-snapshot.ts
//
// What a person's visit leaves for the alert email job, which can't read
// their money itself: the alerts the visit found (alerts.ts), already in
// words, in the language the person reads Prism in; the week's
// numbers for a Monday summary, the last whole month's for the recap early in
// the month, and the next two weeks' bills. Sealed with
// the vault key before it's stored, and kept only while their alert emails
// are on (profiles.sealed_alerts). Every email says when this was taken.
//
// Pure: built from the analysis, checked again when it's opened.

import { alertsFor, type Alert, type AlertKind } from "./alerts";
import { addDays, addMonths, monthKey, startOfMonth } from "./dates";
import { categoryTotals, sumIncome, sumSpending } from "./cashflow";
import { CATEGORIES } from "./categories";
import type { Analysis } from "./model";
import type { Cents, ISODate } from "./types";
import { isLocale, type Locale } from "@/lib/i18n/locale";
import { EN, type T } from "@/lib/i18n/t";

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

/** The last whole month before the visit's day, for the recap early in the next. */
export type MonthlyNumbers = {
  /** "YYYY-MM". */
  month: string;
  income: Cents;
  spent: Cents;
  /** The month before it, when Prism holds all of that month too. */
  before: { income: Cents; spent: Cents } | null;
  /** Where most of it went: up to three categories, the most first. */
  top: { label: string; spent: Cents }[];
  /** Net worth at the month's end, and how it moved over the month, when Prism has both ends. */
  netWorth: { end: Cents; change: Cents } | null;
  /** The bills the forecast has in the 30 days after the visit; null when there's no forecast to ask. */
  ahead: { count: number; total: Cents } | null;
};

/** A bill or payment coming out of the account the forecast follows. */
export type Upcoming = { name: string; date: ISODate; amount: Cents };

export type AlertSnapshot = {
  v: 1;
  /** When it was taken (ISO time). */
  at: string;
  /** Who took it: the person's own visit, or the alert job's morning check of their banks. */
  by: "visit" | "morning";
  /** The visit's own day. */
  today: ISODate;
  /** The language its alerts' words are in. */
  lang: Locale;
  /** Bills short and price rises: a bank's warnings come fresher from the database itself. */
  alerts: Alert[];
  weekly: WeeklyNumbers;
  /** Null when Prism doesn't hold the whole of last month (a bank linked part-way through it). */
  monthly: MonthlyNumbers | null;
  /** What the forecast has going out in the next two weeks; null when there's no forecast to ask. */
  upcoming: Upcoming[] | null;
};

const UPCOMING_DAYS = 14;
const AHEAD_DAYS = 30;
const TOP_CATEGORIES = 3;
const MAX_UPCOMING = 20;
const MAX_ALERTS = 20;

export function alertSnapshot(a: Analysis, at: string, by: AlertSnapshot["by"] = "visit", tr: T = EN): AlertSnapshot {
  const txns = a.data.transactions;
  const t = a.today;
  const nw = a.netWorth;
  return {
    v: 1,
    at,
    by,
    today: t,
    lang: tr.locale,
    alerts: alertsFor(a, tr)
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
    monthly: monthlyNumbers(a),
    upcoming: a.forecast
      ? a.forecast.events
          .filter((e) => e.amount < 0 && e.date <= addDays(t, UPCOMING_DAYS))
          .slice(0, MAX_UPCOMING)
          .map((e) => ({ name: e.merchant, date: e.date, amount: -e.amount }))
      : null,
  };
}

/** Last month, whole, as of the visit's day: only when Prism holds every day of it. */
export function monthlyNumbers(a: Analysis): MonthlyNumbers | null {
  const txns = a.data.transactions;
  const thisMonth = startOfMonth(a.today);
  const from = addMonths(thisMonth, -1);
  const to = addDays(thisMonth, -1);
  const first = txns.reduce<ISODate | null>((min, t) => (t.date <= a.today && (min === null || t.date < min) ? t.date : min), null);
  if (first === null || first > from) return null;
  const prevFrom = addMonths(from, -1);
  const totals = Object.entries(categoryTotals(txns, from, to)) as [keyof typeof CATEGORIES, Cents][];
  const nw = a.netWorth;
  return {
    month: monthKey(from),
    income: sumIncome(txns, from, to),
    spent: sumSpending(txns, from, to),
    before: first <= prevFrom ? { income: sumIncome(txns, prevFrom, addDays(from, -1)), spent: sumSpending(txns, prevFrom, addDays(from, -1)) } : null,
    top: totals
      .filter(([, v]) => v > 0)
      .sort((x, y) => y[1] - x[1])
      .slice(0, TOP_CATEGORIES)
      .map(([c, v]) => ({ label: CATEGORIES[c].label, spent: v })),
    netWorth: nw.length >= 3 ? { end: nw.at(-2)!.net, change: nw.at(-2)!.net - nw.at(-3)!.net } : null,
    ahead: a.forecast
      ? a.forecast.events
          .filter((e) => e.amount < 0 && e.date <= addDays(a.today, AHEAD_DAYS))
          .reduce((x, e) => ({ count: x.count + 1, total: x.total - e.amount }), { count: 0, total: 0 })
      : null,
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

function validMonthly(x: unknown): MonthlyNumbers | null | undefined {
  if (x === undefined || x === null) return null;
  const m = x as Partial<MonthlyNumbers>;
  if (!text(m.month, 7) || !MONTH.test(m.month) || !cents(m.income) || !cents(m.spent)) return undefined;
  if (m.before !== null && !(m.before && cents(m.before.income) && cents(m.before.spent))) return undefined;
  if (!Array.isArray(m.top) || m.top.length > TOP_CATEGORIES || !m.top.every((t) => t && text(t.label, 40) && cents(t.spent))) return undefined;
  if (m.netWorth !== null && !(m.netWorth && cents(m.netWorth.end) && cents(m.netWorth.change))) return undefined;
  if (m.ahead !== null && !(m.ahead && Number.isSafeInteger(m.ahead.count) && m.ahead.count >= 0 && cents(m.ahead.total))) return undefined;
  return {
    month: m.month,
    income: m.income,
    spent: m.spent,
    before: m.before ? { income: m.before.income, spent: m.before.spent } : null,
    top: m.top.map((t) => ({ label: t.label, spent: t.spent })),
    netWorth: m.netWorth ? { end: m.netWorth.end, change: m.netWorth.change } : null,
    ahead: m.ahead ? { count: m.ahead.count, total: m.ahead.total } : null,
  };
}
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
  // Snapshots from before the recap have none; one that's there must read whole.
  const monthly = validMonthly((s as { monthly?: unknown }).monthly);
  if (monthly === undefined) return null;
  const upcoming = s.upcoming?.filter((u): u is Upcoming => !!u && text(u.name, 200) && typeof u.date === "string" && DAY.test(u.date) && cents(u.amount)) ?? null;
  return {
    v: 1,
    at: s.at,
    // Snapshots from before the morning check were all a visit's.
    by: s.by === "morning" ? "morning" : "visit",
    today: s.today,
    // Snapshots from before languages were all in English.
    lang: isLocale(s.lang) ? s.lang : "en",
    alerts: alerts as Alert[],
    weekly: { from: w.from, to: w.to, spent: w.spent, spentBefore: w.spentBefore, month: w.month ? { spent: w.month.spent, limit: w.month.limit } : null, netWorth: w.netWorth, netWorthLastMonth: w.netWorthLastMonth ?? null },
    monthly,
    upcoming: upcoming?.map((u) => ({ name: u.name, date: u.date, amount: u.amount })) ?? null,
  };
}
