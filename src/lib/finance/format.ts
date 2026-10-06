// src/lib/finance/format.ts
//
// Formatting happens only at the edge (DESIGN.md rule 8). Every formatter is
// pinned to US dollars and UTC so the server render and the browser hydrate
// to the same string whatever the viewer's settings or zone. Dates read in the
// page's language when they're given it ("Sep 27", "27 sept"); amounts are
// written the same way in both, as US banks write them for Spanish speakers.

import type { Locale } from "@/lib/i18n/locale";
import { EN, type T } from "@/lib/i18n/t";
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
// Spanish writes months and weekdays in lower case, and the day before the month: "5 oct".
const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
const MONTHS_LONG_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const WEEKDAYS_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function parts(date: ISODate): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y!, m!, d!];
}

/** "Sep 27"; in Spanish "27 sept". */
export function shortDate(date: ISODate, locale: Locale = "en"): string {
  const [, m, d] = parts(date);
  return locale === "es" ? `${d} ${MONTHS_ES[m - 1]}` : `${MONTHS[m - 1]} ${d}`;
}

/** "Sep 1 – 5", "Sep 28 – Oct 3", or "Sep 1" for a single day; in Spanish "1–5 sept", "28 sept – 3 oct". */
export function dayRange(from: ISODate, to: ISODate, locale: Locale = "en"): string {
  if (from === to) return shortDate(from, locale);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  if (locale === "es") return sameMonth ? `${Number(from.slice(8, 10))}–${shortDate(to, locale)}` : `${shortDate(from, locale)} – ${shortDate(to, locale)}`;
  return sameMonth ? `${shortDate(from)} – ${Number(to.slice(8, 10))}` : `${shortDate(from)} – ${shortDate(to)}`;
}

/** "Sat, Sep 27"; in Spanish "sáb, 27 sept". */
export function dayDate(date: ISODate, locale: Locale = "en"): string {
  const [y, m, d] = parts(date);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return locale === "es" ? `${WEEKDAYS_ES[dow]}, ${d} ${MONTHS_ES[m - 1]}` : `${WEEKDAYS[dow]}, ${MONTHS[m - 1]} ${d}`;
}

/** "Sep" from "2026-09" or "2026-09-27"; in Spanish "sept". */
export function monthShort(date: string, locale: Locale = "en"): string {
  return (locale === "es" ? MONTHS_ES : MONTHS)[Number(date.slice(5, 7)) - 1]!;
}

/** "September"; in Spanish "septiembre". */
export function monthLong(date: string, locale: Locale = "en"): string {
  return (locale === "es" ? MONTHS_LONG_ES : MONTHS_LONG)[Number(date.slice(5, 7)) - 1]!;
}

/** "Sep 2026"; in Spanish "sept 2026". */
export function monthYear(date: string, locale: Locale = "en"): string {
  return `${monthShort(date, locale)} ${date.slice(0, 4)}`;
}

export function weekdayShort(dow: number, locale: Locale = "en"): string {
  return (locale === "es" ? WEEKDAYS_ES : WEEKDAYS)[dow]!;
}

/** The first letter in capitals, for a month that starts a sentence: "Octubre". */
export function capitalized(s: string): string {
  return s.charAt(0).toLocaleUpperCase("es") + s.slice(1);
}

/** "Last changed by Sam on Sep 30." for a household list; null when nobody has changed it. */
export function lastChanged(change: { by: string | null; at: string } | null | undefined, t: T = EN): string | null {
  if (!change || !/^\d{4}-\d{2}-\d{2}/.test(change.at)) return null;
  return t("Last changed by {who} on {date}.", { who: change.by ?? t("a household member"), date: shortDate(change.at.slice(0, 10), t.locale) });
}
