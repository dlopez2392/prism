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
