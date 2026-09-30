// src/lib/finance/dates.ts
//
// Calendar arithmetic on ISO dates. Everything goes through UTC midnight so
// there is no DST hour to gain or lose: a "day" here is a calendar square,
// not 86,400 seconds of somebody's local time.

import type { ISODate } from "./types";

export function toUTC(date: ISODate): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

export function fromUTC(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = toUTC(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUTC(d);
}

/** Adds calendar months, clamping the day (Jan 31 + 1 month → Feb 28/29). */
export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y!, m! - 1 + months, 1));
  const last = daysInMonth(fromUTC(target));
  target.setUTCDate(Math.min(d!, last));
  return fromUTC(target);
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000);
}

/** "2026-09" */
export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

export function startOfMonth(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`;
}

export function daysInMonth(date: ISODate): number {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

export function dayOfMonth(date: ISODate): number {
  return Number(date.slice(8, 10));
}

export function dayOfWeek(date: ISODate): number {
  return toUTC(date).getUTCDay();
}

/** The last `count` month keys ending with the month containing `date`, oldest first. */
export function lastMonths(date: ISODate, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(monthKey(addMonths(startOfMonth(date), -i)));
  return out;
}

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The nth `weekday` (0 = Sunday) of a month (1–12); n = -1 is the last one. */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): ISODate {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  if (n === -1) {
    const last = addDays(first, daysInMonth(first) - 1);
    return addDays(last, -((dayOfWeek(last) - weekday + 7) % 7));
  }
  return addDays(first, ((weekday - dayOfWeek(first) + 7) % 7) + (n - 1) * 7);
}

const holidayCache = new Map<number, Set<ISODate>>();

/**
 * The days US banks are closed, as the Federal Reserve observes them: the
 * eleven federal holidays, a Sunday holiday moved to the Monday after (a
 * Saturday one closes nothing). Direct deposit doesn't land on these.
 */
export function bankHolidays(year: number): Set<ISODate> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const fixed = (m: number, d: number) => {
    const date = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return dayOfWeek(date) === 0 ? addDays(date, 1) : date;
  };
  const days = new Set<ISODate>([
    fixed(1, 1), // New Year's Day
    nthWeekdayOfMonth(year, 1, 1, 3), // Martin Luther King Jr. Day
    nthWeekdayOfMonth(year, 2, 1, 3), // Washington's Birthday
    nthWeekdayOfMonth(year, 5, 1, -1), // Memorial Day
    fixed(6, 19), // Juneteenth
    fixed(7, 4), // Independence Day
    nthWeekdayOfMonth(year, 9, 1, 1), // Labor Day
    nthWeekdayOfMonth(year, 10, 1, 2), // Columbus Day
    fixed(11, 11), // Veterans Day
    nthWeekdayOfMonth(year, 11, 4, 4), // Thanksgiving
    fixed(12, 25), // Christmas
  ]);
  holidayCache.set(year, days);
  return days;
}

export function isBusinessDay(date: ISODate): boolean {
  const dow = dayOfWeek(date);
  return dow !== 0 && dow !== 6 && !bankHolidays(Number(date.slice(0, 4))).has(date);
}

/** The day itself if banks are open, else the last day before it that they are: when pay due that day lands. */
export function previousBusinessDay(date: ISODate): ISODate {
  let d = date;
  while (!isBusinessDay(d)) d = addDays(d, -1);
  return d;
}
