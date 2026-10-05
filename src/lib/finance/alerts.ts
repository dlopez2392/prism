// src/lib/finance/alerts.ts
//
// What's worth interrupting someone for: a bank that has stopped updating, or
// will within the week; a bill due before the next paycheck that the account
// it comes out of won't cover; a recurring charge that just went up. Shown on
// Overview, and (once email is switched on) sent by email.
//
// Each alert has an id that names its occasion — this bank's sign-in, this
// bill on this date, this price — so the same news is never sent twice, and
// new news (the next bill, a second price rise) is. Each also has a quiet
// wording with no dollar amounts, for an email that keeps them out.
//
// Pure: reads the analysis, writes nothing.

import { addDays, daysBetween } from "./dates";
import { dayDate, money, money0, shortDate } from "./format";
import type { Analysis } from "./model";
import { normalizeMerchant, perYear } from "./recurring";
import { EN, type T } from "@/lib/i18n/t";
import type { ISODate } from "./types";

export type AlertKind = "bank" | "bill-short" | "price-rise";

export type Alert = {
  /** Stable for one occasion: the same bank's same problem, the same bill on the same day, the same new price. */
  id: string;
  kind: AlertKind;
  title: string;
  detail: string;
  /** The same news without dollar amounts. */
  quiet: { title: string; detail: string };
  /** The day it's about (a bill's due date, a bank's cut-off), if it has one. */
  on: ISODate | null;
  href: string;
  /** Money that won't be there, or a bank that won't update: worth acting on now. */
  urgent: boolean;
};

/** How far ahead a short bill is looked for when no paycheck is scheduled. */
const NO_PAYDAY_DAYS = 14;
/** A price rise is news for this long after the first higher charge. */
const PRICE_NEWS_DAYS = 35;

const isoDay = (t: string): ISODate => t.slice(0, 10) as ISODate;

function bankAlerts(a: Analysis, t: T): Alert[] {
  const out: Alert[] = [];
  const { locale } = t;
  for (const inst of a.data.institutions) {
    if (inst.source !== "plaid" && inst.source !== "coinbase") continue;
    if (inst.signInAgain) {
      const detail = inst.lastSyncedAt
        ? t("Sign in again on Connections and it carries on where it left off. It last updated {date}.", { date: shortDate(isoDay(inst.lastSyncedAt), locale) })
        : t("Sign in again on Connections and it carries on where it left off.");
      const title = t("{bank} needs you to sign in again", { bank: inst.name });
      out.push({
        id: `bank:${inst.id}:sign-in`,
        kind: "bank",
        title,
        detail,
        quiet: { title, detail },
        on: null,
        href: "/connections",
        urgent: true,
      });
    } else if (inst.disconnectsAt) {
      const on = isoDay(inst.disconnectsAt);
      const detail = t("Unless you sign in again before then. It takes a minute on Connections, and nothing is lost.");
      const title = t("{bank} stops updating on {date}", { bank: inst.name, date: dayDate(on, locale) });
      out.push({
        id: `bank:${inst.id}:disconnect:${on}`,
        kind: "bank",
        title,
        detail,
        quiet: { title, detail },
        on,
        href: "/connections",
        urgent: true,
      });
    }
  }
  return out;
}

/**
 * The first bill up to the next paycheck after which the paying account is
 * forecast below zero — on payday itself only if it's short even with the
 * paycheck in. One alert, not one per bill: the first is the one to act on,
 * and the rest are on the Future screen.
 */
function shortBill(a: Analysis, t: T): Alert | null {
  const { locale } = t;
  const f = a.forecast;
  if (!f || !a.checking) return null;
  const payday = f.events.find((e) => e.amount > 0 && e.kind === "income")?.date ?? null;
  const until = payday ?? addDays(a.today, NO_PAYDAY_DAYS);
  const expected = new Map(f.points.map((p) => [p.date, p.expected]));
  for (const e of f.events) {
    if (e.date > until || e.amount >= 0) continue;
    // The balance at the end of that day, every bill and paycheck of the day in.
    const after = expected.get(e.date);
    if (after === undefined || after >= 0) continue;
    const account = a.checking.name;
    const fix = t("Moving money in before then avoids a declined payment or an overdraft fee.");
    const due = (short: string | null) => {
      const vars = { account, short: short ?? "", payday: payday ? dayDate(payday, locale) : "", n: daysBetween(a.today, until) };
      // Whole sentences, so each language can put the parts in its own order.
      if (payday === e.date) return short ? t("It's due on payday, and even with your paycheck in, {account} is on track to be {short} short after it.", vars) : t("It's due on payday, and even with your paycheck in, {account} is on track to be short after it.", vars);
      if (payday) return short ? t("It's due before your paycheck on {payday}, and {account} is on track to be {short} short after it.", vars) : t("It's due before your paycheck on {payday}, and {account} is on track to be short after it.", vars);
      return short ? t("It's due in the next {n} days, and {account} is on track to be {short} short after it.", vars) : t("It's due in the next {n} days, and {account} is on track to be short after it.", vars);
    };
    return {
      id: `bill-short:${normalizeMerchant(e.merchant)}:${e.date}`,
      kind: "bill-short",
      title: t("{bill} ({amount}) may not be covered on {date}", { bill: e.merchant, amount: money0(-e.amount), date: dayDate(e.date, locale) }),
      detail: `${due(money0(-after))} ${fix}`,
      quiet: {
        title: t("{bill} may not be covered on {date}", { bill: e.merchant, date: dayDate(e.date, locale) }),
        detail: `${due(null)} ${fix}`,
      },
      on: e.date,
      href: "/future",
      urgent: true,
    };
  }
  return null;
}

/** A recurring charge whose newest amount is higher than the one before it, while that's still news. */
function priceRises(a: Analysis, t: T): Alert[] {
  const out: Alert[] = [];
  for (const s of a.streams) {
    const change = s.priceChange;
    if (!change || s.kind === "transfer" || s.kind === "income" || s.amount >= 0) continue;
    const from = Math.abs(change.from);
    const to = Math.abs(change.to);
    if (to <= from || daysBetween(change.date, a.today) > PRICE_NEWS_DAYS) continue;
    const yearly = (to - from) * perYear(s.cadence);
    out.push({
      id: `price-rise:${s.id}:${to}`,
      kind: "price-rise",
      title: t("{merchant} went up to {amount}", { merchant: s.merchant, amount: money(to) }),
      detail: t("It was {before}. That's {yearly} more a year, if you still use it.", { before: money(from), yearly: money0(yearly) }),
      quiet: {
        title: t("{merchant} raised its price", { merchant: s.merchant }),
        detail: t("Its latest charge, on {date}, was higher than the one before.", { date: shortDate(change.date, t.locale) }),
      },
      on: change.date,
      href: "/cash-flow",
      urgent: false,
    });
  }
  return out;
}

/** Everything worth a heads-up, the urgent first, in the language of `t` (English unless asked). */
export function alertsFor(a: Analysis, t: T = EN): Alert[] {
  const bill = shortBill(a, t);
  return [...bankAlerts(a, t), ...(bill ? [bill] : []), ...priceRises(a, t)].sort((x, y) => Number(y.urgent) - Number(x.urgent));
}
