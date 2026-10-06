// src/lib/billing/plans.ts
//
// Prism Plus as data: the plans, their prices, the trial, and what the free
// plan keeps. Shared by the pricing page, the gates and the Stripe client, so
// the price a person is shown is the price Stripe is asked to charge: the
// server reads each price from Stripe by its lookup key and refuses to start
// a checkout whose amount, currency or interval differs from these
// (stripe.ts, `priceProblem`).
//
// The founding offer: the price someone subscribes at stays theirs for as
// long as their subscription carries on (Stripe keeps a subscription on its
// price; nothing here ever moves one). Ending the offer means new prices
// under NEW lookup keys (`_2027`, say) and new amounts here. Never move an
// existing key to another price: a subscription's plan is read from its
// price's key (`planOfLookupKey`), so the old prices must keep theirs.
//
// No server-only imports: the pricing page and the upgrade cards read it.

import { BRAND } from "@/lib/brand";
import { msg, type T } from "@/lib/i18n/t";

export type PlanId = "plus" | "household";
export type Interval = "month" | "year";

/** What each plan costs, in cents, before any sales tax. */
export const PRICES: Readonly<Record<PlanId, Readonly<Record<Interval, number>>>> = {
  plus: { month: 599, year: 4900 },
  household: { month: 899, year: 7900 },
};

/** Stripe's name for each price (set on the price in Stripe's dashboard). */
export const LOOKUP_KEYS: Readonly<Record<PlanId, Readonly<Record<Interval, string>>>> = {
  plus: { month: "prism_plus_monthly", year: "prism_plus_yearly" },
  household: { month: "prism_household_monthly", year: "prism_household_yearly" },
};

export const CURRENCY = "usd";

/** A first subscription starts with this many days free; Stripe charges on the day after. */
export const TRIAL_DAYS = 14;

/** People a Household plan covers: everyone in a household, which holds four (households migration). */
export const HOUSEHOLD_SEATS = 4;

/** Bank connections the free plan keeps up to date. */
export const FREE_CONNECTIONS = 1;

/** Shown while launch prices are offered as founding-member prices (see the top of this file). */
export const FOUNDING_OFFER = true;

/**
 * Which connections pause once Prism Plus ends: all but the free plan's
 * first, oldest first, so the one kept is always the same one and linking
 * nothing new can change it.
 */
export function pausedBeyondFree<C extends { itemId: string; linkedAt: string }>(connections: readonly C[]): Set<string> {
  const oldestFirst = [...connections].sort((a, b) => (a.linkedAt < b.linkedAt ? -1 : a.linkedAt > b.linkedAt ? 1 : a.itemId < b.itemId ? -1 : 1));
  return new Set(oldestFirst.slice(FREE_CONNECTIONS).map((c) => c.itemId));
}

/** The plan and interval a price's lookup key names, or null for a price Prism doesn't sell. */
export function planOfLookupKey(key: unknown): { plan: PlanId; interval: Interval } | null {
  if (typeof key !== "string") return null;
  const m = /^prism_(plus|household)_(monthly|yearly)(?:_[a-z0-9]{1,20})?$/.exec(key);
  if (!m) return null;
  return { plan: m[1] as PlanId, interval: m[2] === "monthly" ? "month" : "year" };
}

/** "$5.99", "$49": dollars, with cents only when there are some. */
export function priceLabel(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/** How much a year saves against twelve months, as a whole percentage, rounded down so it's never overstated. */
export function yearlySaving(plan: PlanId): number {
  const p = PRICES[plan];
  return Math.floor((1 - p.year / (p.month * 12)) * 100);
}

/** The parts of Prism Plus that a free account reaches and is told about. */
export type PlusFeature = "banks" | "investments" | "coinbase" | "alerts" | "household" | "apps" | "taxes" | "calendar" | "home-values" | "matching";

/** For each, the sentence shown where someone on the free plan reaches it. */
export const PLUS_NEEDS: Readonly<Record<PlusFeature, string>> = {
  banks: msg("Connecting more than one bank comes with {plus}."),
  investments: msg("Connecting an investment account comes with {plus}."),
  coinbase: msg("Connecting Coinbase comes with {plus}."),
  alerts: msg("Alert emails and alerts on your phone come with {plus}."),
  household: msg("Sharing with a household comes with {plus}."),
  apps: msg("Connecting Claude or ChatGPT comes with {plus}."),
  taxes: msg("Your tax year comes with {plus}."),
  calendar: msg("A calendar that keeps itself up to date comes with {plus}."),
  "home-values": msg("Keeping your home's value up to date comes with {plus}."),
  matching: msg("Matching orders and payments to your bank comes with {plus}."),
};

/** The sentence for someone on the free plan who reached a Plus feature. */
export function plusNeeds(feature: PlusFeature, t: T): string {
  return t(PLUS_NEEDS[feature], { plus: BRAND.plus });
}

/** A feature named in a link (`/pricing?need=taxes`), or null. */
export function isPlusFeature(x: unknown): x is PlusFeature {
  return typeof x === "string" && Object.hasOwn(PLUS_NEEDS, x);
}

/** Thrown where someone without Prism Plus reaches a part of it that has no page to say so on (a connected app's question). */
export class PlusRequired extends Error {
  constructor(readonly feature: PlusFeature) {
    super(`${feature} needs ${BRAND.plus}`);
    this.name = "PlusRequired";
  }
}

/** The pricing page, saying what brought someone there. */
export function pricingFor(feature: PlusFeature): string {
  return `/pricing?need=${feature}`;
}

/** What Prism Plus adds, as the pricing page lists it. */
export const PLUS_LINES: readonly string[] = [
  msg("Every bank, card and loan you have, kept up to date"),
  msg("Investment accounts and Coinbase"),
  msg("Alert emails, alerts on your phone and a morning check of your banks"),
  msg("A household of up to four, sharing only what each of you chooses"),
  msg("Ask Claude or ChatGPT about your money"),
  msg("Your tax year, sorted into what a return asks about"),
  msg("Your bills in your own calendar, kept up to date"),
  msg("Your home's value, estimated each month"),
  msg("Amazon orders and Venmo, PayPal and Cash App payments matched to your bank"),
];

/** What the free plan always includes. */
export const FREE_LINES: readonly string[] = [
  msg("Spending, cash flow, budgets and goals"),
  msg("One bank connection"),
  msg("Your home, car and anything else, added by hand"),
  msg("History imported from Mint, Monarch or a spreadsheet"),
  msg("In English and Spanish"),
];
