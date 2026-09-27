// apps/finance/src/lib/finance/format.ts
//
// Formatting happens only at the edge (DESIGN.md rule 8). Every formatter is
// pinned to en-US and UTC so the server render and the browser hydrate to the
// same string whatever the viewer's locale or zone.

import type { Cents, ISODate } from "./types";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** $1,234.56 — for rows and exact amounts. */
export function money(cents: Cents): string {
  return usd.format(cents / 100);
}

/** $1,235 — for headline figures where pennies are noise. */
export function money0(cents: Cents): string {
  return usd0.format(Math.round(cents / 100));
}

/** $1.2K / $48K / $1.3M — for axis ticks and tight tiles. */
export function moneyCompact(cents: Cents): string {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${trim(abs / 1_000_000)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}K`;
  if (abs >= 1_000) return `${sign}$${trim(abs / 1000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

/** +$120 / −$45 — a signed delta, with a true minus sign. */
export function signedMoney0(cents: Cents): string {
  const s = money0(Math.abs(cents));
  if (cents > 0) return `+${s}`;
  if (cents < 0) return `−${s}`;
  return s;
}

export function percent(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function signedPercent(ratio: number, digits = 0): string {
  const s = `${Math.abs(ratio * 100).toFixed(digits)}%`;
  if (ratio > 0) return `+${s}`;
  if (ratio < 0) return `−${s}`;
  return s;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(date: ISODate): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y!, m!, d!];
}

/** "Sep 27" */
export function shortDate(date: ISODate): string {
  const [, m, d] = parts(date);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "Sat, Sep 27" */
export function dayDate(date: ISODate): string {
  const [y, m, d] = parts(date);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[dow]}, ${MONTHS[m - 1]} ${d}`;
}

/** "Sep" from "2026-09" or "2026-09-27" */
export function monthShort(date: string): string {
  return MONTHS[Number(date.slice(5, 7)) - 1]!;
}

/** "September" */
export function monthLong(date: string): string {
  return MONTHS_LONG[Number(date.slice(5, 7)) - 1]!;
}

/** "Sep 2026" */
export function monthYear(date: string): string {
  return `${monthShort(date)} ${date.slice(0, 4)}`;
}

export function weekdayShort(dow: number): string {
  return WEEKDAYS[dow]!;
}
