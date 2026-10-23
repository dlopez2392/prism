// src/lib/legal-notice.ts
//
// Telling people about a change before it takes effect, as the Terms and the
// privacy policy promise ("If a change matters, we'll tell you in the app or
// by email before it takes effect"). A notice is data: what changes, on
// which day, in plain words. Two things carry it:
//
//   - a bar under the header for everyone signed in, from the day it's
//     published until NOTICE_SHOWN_DAYS after the change, which stays put
//     away once they choose Got it (the prism-notice cookie, set by
//     server/notice-actions.ts, holds the id of the notice they've read);
//   - one email to every account, sent by the daily job once the operator
//     names the notice in NOTICE_EMAIL (alerts/notice-job.ts). Never before:
//     emailing every customer is the owner's call.
//
// The first notice is Prism Plus: from PLUS_STARTS it's a paid plan. Until
// then live Stripe keys sell nothing (`liveSalesOpen`, read by
// billing/plus.ts), so no one is charged before the day the notice promised.
// Test keys are never held back: the owner tries Checkout with them first.
//
// No server-only imports: the bar's words come from here.

import { monthLong } from "@/lib/finance/format";
import type { ISODate } from "@/lib/finance/types";
import type { Locale } from "@/lib/i18n/locale";
import { msg, type T } from "@/lib/i18n/t";
import { PRICES, priceLabel, TRIAL_DAYS, FREE_CONNECTIONS } from "@/lib/billing/plans";

export const NOTICE_COOKIE = "prism-notice";

/** The bar stays this many days past a change's date, for anyone who hasn't been in since. */
export const NOTICE_SHOWN_DAYS = 30;

/** The day Prism Plus starts charging, as every account was told (the plus-2026-11 notice). */
export const PLUS_STARTS: ISODate = "2026-11-23";

/** Midnight at the start of PLUS_STARTS in Texas (CST, UTC−6), where BIS is: live sales open then. */
const PLUS_STARTS_AT = Date.parse(`${PLUS_STARTS}T06:00:00Z`);

/** Whether live Stripe keys may sell Prism Plus yet. Test keys always may. */
export function liveSalesOpen(now: Date = new Date()): boolean {
  return now.getTime() >= PLUS_STARTS_AT;
}

export type ChangeNotice = {
  /** Names the notice in the cookie, the delivery log and NOTICE_EMAIL. */
  id: string;
  /** The first day it's shown. */
  published: ISODate;
  /** The day the change takes effect. */
  effective: ISODate;
  /** "{date}" is the effective date, written out. */
  title: string;
  /** Each says one thing that changes; their {names} are filled by `noticeWords`. */
  points: string[];
};

export const NOTICES: readonly ChangeNotice[] = [
  {
    id: "plus-2026-11",
    published: "2026-10-23",
    effective: PLUS_STARTS,
    title: msg("Prism Plus starts on {date}"),
    points: [
      msg(
        "On {date}, Prism Plus becomes a paid plan: {plusMonth} a month or {plusYear} a year for you, or {householdMonth} a month or {householdYear} a year for everyone in your household, plus sales tax where it applies.",
      ),
      msg("Some features become part of Prism Plus then. The free plan keeps {connections} bank connection up to date, and the Prism Plus page shows what each plan includes."),
      msg("A first subscription starts with {days} days free. Nothing is charged unless you choose Prism Plus, and you can cancel any time on your Account page."),
      msg("The Terms of Service now also allow a business you own by yourself and report on Schedule C."),
      msg("If you don't want the new terms, you can delete your account on your Account page before then."),
    ],
  },
];

const ID = /^[a-z0-9-]{1,40}$/;

export function noticeById(id: unknown): ChangeNotice | null {
  return typeof id === "string" && ID.test(id) ? (NOTICES.find((n) => n.id === id) ?? null) : null;
}

function addDays(day: ISODate, n: number): ISODate {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The newest notice shown on `today`: published, and not more than NOTICE_SHOWN_DAYS past its change. */
export function currentNotice(today: ISODate, notices: readonly ChangeNotice[] = NOTICES): ChangeNotice | null {
  const showing = notices.filter((n) => n.published <= today && today <= addDays(n.effective, NOTICE_SHOWN_DAYS));
  return showing.sort((a, b) => (a.published < b.published ? 1 : -1))[0] ?? null;
}

/** Whether its change has taken effect by `today`: the bar then says so in the past tense. */
export function inEffect(n: ChangeNotice, today: ISODate): boolean {
  return today >= n.effective;
}

/** "November 23, 2026"; in Spanish "23 de noviembre de 2026". */
export function fullDate(day: ISODate, locale: Locale): string {
  const d = Number(day.slice(8, 10));
  const y = day.slice(0, 4);
  return locale === "es" ? `${d} de ${monthLong(day, "es")} de ${y}` : `${monthLong(day, "en")} ${d}, ${y}`;
}

/** A notice in the reader's language, every {name} filled. */
export function noticeWords(n: ChangeNotice, t: T): { title: string; points: string[] } {
  const vars = {
    date: fullDate(n.effective, t.locale),
    plusMonth: priceLabel(PRICES.plus.month),
    plusYear: priceLabel(PRICES.plus.year),
    householdMonth: priceLabel(PRICES.household.month),
    householdYear: priceLabel(PRICES.household.year),
    days: TRIAL_DAYS,
    connections: FREE_CONNECTIONS,
  };
  return { title: t(n.title, vars), points: n.points.map((p) => t(p, vars)) };
}
