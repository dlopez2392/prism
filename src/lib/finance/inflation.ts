// src/lib/finance/inflation.ts
//
// Your own inflation rate: how much more the same things cost the person now
// than a year ago, from their own charges, not the national average. The
// card on Spending and the connector read it from here.
//
// Two windows: the last WINDOW_DAYS, and WINDOW_DAYS centred on a year ago.
// A place compared must have charged in both, and is read one of two ways:
//   - a PRICE: at least MIN_REPEATS charges a year ago, all within
//     FIXED_SPREAD of their middle (rent, a subscription, a bill, a
//     membership), and charges now at one price too, or at that old price
//     until the latest stepped (a rise this month): the same thing bought
//     again, so the change is the price's. A purchase that didn't repeat a
//     year ago is never a price, however alike two of them look;
//   - a typical VISIT: at least MIN_VISITS charges in each window (the
//     grocer, the gas station): the middle charge, which moves with the price
//     AND with what's bought, so it's said as what a visit costs, never as a
//     price, and it's kept out of the rate.
// The rate is the change in prices, each weighted by what the person spends
// there now (a $1,400 rent rising 3% moves it more than a $10 app rising
// 20%), stated only with MIN_PLACES prices to go on.
//
// Pure: reads the transactions.

import { isSpending } from "./cashflow";
import { addDays, daysBetween } from "./dates";
import { wholeLines } from "./details";
import { normalizeMerchant } from "./merchant";
import type { Cents, ISODate, Transaction } from "./types";

export const WINDOW_DAYS = 60;
/** Charges within this share of their middle are one price. */
const FIXED_SPREAD = 0.05;
/** Charges it takes in each window to read a price: one charge is a purchase, not a price. */
const MIN_REPEATS = 2;
/** Charges it takes in each window to read a typical visit. */
const MIN_VISITS = 4;
const LOANS = /\b(loan|financ\w*|mortgage)\b/i;
/** Prices it takes to state a rate at all. */
export const MIN_PLACES = 2;

export type PriceChange = {
  name: string;
  kind: "price" | "visit";
  /** What it cost a year ago, and now: the price, or a typical visit. */
  before: Cents;
  after: Cents;
  /** after ÷ before − 1. */
  change: number;
  /** What the person spends there in a year at today's pace. */
  yearly: Cents;
  /** What the change costs in a year at today's pace (negative when it's cheaper). */
  extraYearly: Cents;
};

export type Inflation = {
  /** The change in prices, weighted by what's spent at each now; null with fewer than MIN_PLACES prices. */
  rate: number | null;
  /** What the price changes add to a year, at today's pace. */
  extraYearly: Cents;
  /** The same things bought again: prices, the biggest effect on a year first. */
  prices: PriceChange[];
  /** What a typical visit costs at the places the person goes most, the biggest effect first. Never in the rate. */
  visits: PriceChange[];
  /** The windows compared. */
  now: { from: ISODate; to: ISODate };
  yearAgo: { from: ISODate; to: ISODate };
};

const middle = (xs: Cents[]): Cents => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};
const steady = (xs: Cents[]): boolean => {
  const mid = middle(xs);
  return mid > 0 && xs.every((x) => Math.abs(x - mid) <= mid * FIXED_SPREAD);
};
/** A weighted average of changes; null when nothing weighs. */
function weighted(rows: PriceChange[]): number | null {
  const total = rows.reduce((s, r) => s + r.yearly, 0);
  return total > 0 ? rows.reduce((s, r) => s + r.change * r.yearly, 0) / total : null;
}

export function inflationFor(txns: Transaction[], today: ISODate): Inflation {
  const now = { from: addDays(today, -WINDOW_DAYS + 1), to: today };
  const yearAgo = { from: addDays(today, -365 - WINDOW_DAYS / 2), to: addDays(today, -365 + WINDOW_DAYS / 2) };
  const inWin = (t: Transaction, w: { from: ISODate; to: ISODate }) => t.date >= w.from && t.date <= w.to;

  const byPlace = new Map<string, { name: string; now: Cents[]; then: Cents[] }>();
  for (const t of [...wholeLines(txns)].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    // A loan's payment is set by its contract and a gift by its giver: neither is a price.
    if (t.pending || t.amount >= 0 || !isSpending(t) || t.taxHint || t.interestCharge || LOANS.test(t.merchant)) continue;
    const key = normalizeMerchant(t.merchant);
    if (!key) continue;
    const row = byPlace.get(key) ?? { name: t.merchant, now: [], then: [] };
    // Oldest first within each window, so a window's last is its latest charge.
    if (inWin(t, now)) {
      row.now.push(-t.amount);
      row.name = t.merchant;
    } else if (inWin(t, yearAgo)) row.then.push(-t.amount);
    else continue;
    byPlace.set(key, row);
  }

  const span = daysBetween(now.from, now.to) + 1;
  const changes: PriceChange[] = [];
  for (const p of byPlace.values()) {
    if (!p.now.length || !p.then.length) continue;
    const yearly = Math.round((p.now.reduce((s, x) => s + x, 0) * 365) / span);
    let kind: PriceChange["kind"];
    // A price that stepped up (or down) within the last window is its latest charge, when the ones before it were last year's.
    const latest = p.now.at(-1)!;
    // A year ago it repeated at one price, so even one charge now is that same thing bought again.
    const stepped = steady(p.then) && p.now.slice(0, -1).every((x) => Math.abs(x - middle(p.then)) <= middle(p.then) * FIXED_SPREAD);
    if (p.then.length >= MIN_REPEATS && steady(p.then) && (steady(p.now) || stepped)) kind = "price";
    else if (p.now.length >= MIN_VISITS && p.then.length >= MIN_VISITS) kind = "visit";
    else continue;
    const before = middle(p.then);
    const after = kind === "price" && !steady(p.now) ? latest : middle(p.now);
    const change = after / before - 1;
    // What the same spending would have cost at last year's prices, against what it costs now.
    const extraYearly = Math.round(yearly - yearly / (1 + change));
    changes.push({ name: p.name, kind, before, after, change, yearly, extraYearly });
  }
  changes.sort((a, b) => Math.abs(b.extraYearly) - Math.abs(a.extraYearly) || b.yearly - a.yearly);

  const prices = changes.filter((c) => c.kind === "price");
  return {
    rate: prices.length >= MIN_PLACES ? weighted(prices) : null,
    extraYearly: prices.reduce((s, c) => s + c.extraYearly, 0),
    prices,
    visits: changes.filter((c) => c.kind === "visit"),
    now,
    yearAgo,
  };
}
