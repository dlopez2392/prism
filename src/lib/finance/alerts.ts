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

function bankAlerts(a: Analysis): Alert[] {
  const out: Alert[] = [];
  for (const inst of a.data.institutions) {
    if (inst.source !== "plaid" && inst.source !== "coinbase") continue;
    if (inst.signInAgain) {
      const since = inst.lastSyncedAt ? ` It last updated ${shortDate(isoDay(inst.lastSyncedAt))}.` : "";
      const detail = `Sign in again on Connections and it carries on where it left off.${since}`;
      out.push({
        id: `bank:${inst.id}:sign-in`,
        kind: "bank",
        title: `${inst.name} needs you to sign in again`,
        detail,
        quiet: { title: `${inst.name} needs you to sign in again`, detail },
        on: null,
        href: "/connections",
        urgent: true,
      });
    } else if (inst.disconnectsAt) {
      const on = isoDay(inst.disconnectsAt);
      const detail = `Unless you sign in again before then. It takes a minute on Connections, and nothing is lost.`;
      out.push({
        id: `bank:${inst.id}:disconnect:${on}`,
        kind: "bank",
        title: `${inst.name} stops updating on ${dayDate(on)}`,
        detail,
        quiet: { title: `${inst.name} stops updating on ${dayDate(on)}`, detail },
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
function shortBill(a: Analysis): Alert | null {
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
    const before =
      payday === e.date ? `on payday, and even with your paycheck in,` : payday ? `before your paycheck on ${dayDate(payday)}, and` : `in the next ${daysBetween(a.today, until)} days, and`;
    const account = a.checking.name;
    return {
      id: `bill-short:${normalizeMerchant(e.merchant)}:${e.date}`,
      kind: "bill-short",
      title: `${e.merchant} (${money0(-e.amount)}) may not be covered on ${dayDate(e.date)}`,
      detail: `It's due ${before} ${account} is on track to be ${money0(-after)} short after it. Moving money in before then avoids a declined payment or an overdraft fee.`,
      quiet: {
        title: `${e.merchant} may not be covered on ${dayDate(e.date)}`,
        detail: `It's due ${before} ${account} is on track to be short after it. Moving money in before then avoids a declined payment or an overdraft fee.`,
      },
      on: e.date,
      href: "/future",
      urgent: true,
    };
  }
  return null;
}

/** A recurring charge whose newest amount is higher than the one before it, while that's still news. */
function priceRises(a: Analysis): Alert[] {
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
      title: `${s.merchant} went up to ${money(to)}`,
      detail: `It was ${money(from)}. That's ${money0(yearly)} more a year, if you still use it.`,
      quiet: { title: `${s.merchant} raised its price`, detail: `Its latest charge, on ${shortDate(change.date)}, was higher than the one before.` },
      on: change.date,
      href: "/cash-flow",
      urgent: false,
    });
  }
  return out;
}

/** Everything worth a heads-up, the urgent first. */
export function alertsFor(a: Analysis): Alert[] {
  const bill = shortBill(a);
  return [...bankAlerts(a), ...(bill ? [bill] : []), ...priceRises(a)].sort((x, y) => Number(y.urgent) - Number(x.urgent));
}
