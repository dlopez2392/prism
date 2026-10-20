// src/lib/finance/subscriptions.ts
//
// Everything the person pays for again and again, in one list: the
// Subscriptions page, its alerts and the connectors read it from here, so
// they never disagree about what counts or what it all costs.
//
// What counts:
//   - a stream recurring.ts calls a subscription (monthly or more often);
//   - one that comes every three, six or twelve months and would read as a
//     subscription if it came monthly (looksLikeSubscription): Prime yearly,
//     a membership. Its stream stays a "bill", so what Future asks to be set
//     aside never changes; it's only listed here as what it is;
//   - whatever the person said: a shop's charge is one (`is: true`), or isn't
//     (`is: false`), whatever Prism made of it;
//   - the ones they added by hand, which Prism can't see. Those count in the
//     subscription total and nowhere else: they're not in the bank, so not in
//     the forecast either.
//
// A subscription the person says they CANCELLED leaves the list for the
// cancelled one, which keeps watching: a charge from that shop dated more
// than CANCEL_GRACE_DAYS after the day they gave is one that shouldn't have
// come, and says so (alerts.ts).
//
// A NEW subscription is one whose first charge Prism saw within NEW_DAYS;
// one that followed a charge of a dollar or less from the same shop (a trial
// that asked for a card) started after a trial.
//
// Apple and Google bill many subscriptions under their own name, each on its
// own day and at its own price, so they rarely repeat as one rhythm. Prism
// can't see inside those charges: it counts what each billed in the last
// APP_STORE_DAYS and says where on the phone the list is.
//
// Pure: reads the streams, the transactions and the person's notes.

import { addDays, daysBetween } from "./dates";
import { ruleKey, wholeLines, type OwnCadence, type SubscriptionNotes } from "./details";
import { isLong, looksLikeSubscription, monthlyCost, nthAfter, perYear, type Cadence, type RecurringStream } from "./recurring";
import type { Cents, ISODate, Transaction } from "./types";

/** A charge dated more than this many days after the day someone cancelled shouldn't have come (a few days covers one that was already on its way). */
export const CANCEL_GRACE_DAYS = 3;
/** A subscription whose first charge Prism saw within this many days is new. */
export const NEW_DAYS = 100;
/** A charge of this much or less (a dollar), from the same shop up to TRIAL_DAYS before the first real one, was a trial asking for a card. */
const TRIAL_MAX: Cents = 100;
const TRIAL_DAYS = 45;
/** What Apple and Google billed is counted over this many days: about a month. */
export const APP_STORE_DAYS = 31;

export type AppStore = "apple" | "google";
/** Where to cancel: the service's own page for it. */
export type CancelLink = { service: string; url: string };

/**
 * The cancel page of each service many people pay for, checked by hand
 * (2026-10-20): each address is the service's own account or help page for
 * cancelling. Matched against the bank's name for the charge; the services
 * first, then Apple and Google, which bill for many others.
 */
const CANCEL_LINKS: { test: RegExp; service: string; url: string }[] = [
  { test: /\bnetflix\b/i, service: "Netflix", url: "https://www.netflix.com/cancelplan" },
  { test: /\bspotify\b/i, service: "Spotify", url: "https://support.spotify.com/us/article/cancel-premium/" },
  { test: /\bhulu\b/i, service: "Hulu", url: "https://help.hulu.com/article/hulu-cancel-hulu-subscription" },
  { test: /\bdisney\s*(?:\+|plus)/i, service: "Disney+", url: "https://help.disneyplus.com/article/disneyplus-cancel" },
  { test: /\bhbo\s*max\b|\bmax\.com\b/i, service: "HBO Max", url: "https://help.hbomax.com/cancel" },
  { test: /\bparamount\s*(?:\+|plus)/i, service: "Paramount+", url: "https://support.paramountplus.com/s/article/PI-How-do-I-cancel-my-subscription" },
  { test: /\bpeacock\b/i, service: "Peacock", url: "https://www.peacocktv.com/account/plans" },
  { test: /\byoutube\b/i, service: "YouTube", url: "https://www.youtube.com/paid_memberships" },
  { test: /\baudible\b/i, service: "Audible", url: "https://www.audible.com/account/overview" },
  { test: /\bamazon\s*prime\b|\bprime\s*video\b|\bamzn\s*prime\b/i, service: "Amazon Prime", url: "https://www.amazon.com/gp/primecentral" },
  { test: /\bgoogle\s*\*?\s*(?:one|storage)\b/i, service: "Google One", url: "https://one.google.com/storage" },
  { test: /\badobe\b/i, service: "Adobe", url: "https://account.adobe.com/plans" },
  { test: /\bmicrosoft\b|\bmsft\b|\bxbox\b/i, service: "Microsoft", url: "https://account.microsoft.com/services" },
  { test: /\bdropbox\b/i, service: "Dropbox", url: "https://www.dropbox.com/account/plan" },
  { test: /\bnytimes\b|\bny\s*times\b|\bnew\s*york\s*times\b/i, service: "The New York Times", url: "https://myaccount.nytimes.com/seg/subscription" },
  { test: /\bdashpass\b|\bdoordash\b/i, service: "DashPass", url: "https://help.doordash.com/en-us/consumers/article/how-do-i-cancel-my-dashpass-subscription" },
  { test: /\blinkedin\b/i, service: "LinkedIn", url: "https://www.linkedin.com/premium/manage" },
  { test: /\bopenai\b|\bchatgpt\b/i, service: "ChatGPT", url: "https://help.openai.com/en/articles/7232927-canceling-your-chatgpt-subscription" },
  { test: /\banthropic\b|\bclaude\.ai\b/i, service: "Claude", url: "https://claude.ai/settings/billing" },
];
const APP_STORE_LINKS: Record<AppStore, CancelLink> = {
  apple: { service: "Apple", url: "https://support.apple.com/en-us/118428" },
  google: { service: "Google Play", url: "https://play.google.com/store/account/subscriptions" },
};

/** Apple or Google, when the bank's name for a charge says one of them billed it for something else. */
export function appStoreOf(merchant: string): AppStore | null {
  if (/\bapple\.com\b|\bitunes\b|\bapple\s+services\b|^apple$/i.test(merchant.trim())) return "apple";
  if (/\bgoogle\s*\*?\s*play\b|^google\s*\*/i.test(merchant.trim()) && !/\bgoogle\s*\*?\s*(?:one|storage)\b/i.test(merchant)) return "google";
  return null;
}

/** Where to cancel a charge from this shop, when Prism knows: the service's own page, else the store that billed it. */
export function cancelLinkFor(merchant: string): CancelLink | null {
  const own = CANCEL_LINKS.find((c) => c.test.test(merchant));
  if (own) return { service: own.service, url: own.url };
  const store = appStoreOf(merchant);
  return store ? APP_STORE_LINKS[store] : null;
}

export type SubscriptionRow = {
  /** The shop, as a subscription mark is kept under (ruleKey); for one added by hand, its id. */
  key: string;
  name: string;
  /** What it charges each time: its latest charge, positive. */
  amount: Cents;
  cadence: Cadence;
  monthly: Cents;
  yearly: Cents;
  /** The next charge expected, or for one added by hand the next one they gave, rolled on to today. */
  nextDate: ISODate;
  lastDate: ISODate | null;
  /** Found by Prism, marked one by the person, or added by hand. */
  source: "found" | "marked" | "added";
  /** Its price in the last few months, when it changed: positive cents. */
  priceChange: { from: Cents; to: Cents; date: ISODate } | null;
  /** When its first charge came, when that was recent; null for one that's been going a while. */
  started: ISODate | null;
  /** It began after a trial (a charge of a dollar or less shortly before its first). */
  afterTrial: boolean;
  billedBy: AppStore | null;
  cancel: CancelLink | null;
  /** The stream it was found from: null for one added by hand. */
  streamId: string | null;
  transactionIds: string[];
};

export type CancelledRow = {
  key: string;
  name: string;
  /** The day the person said they cancelled it. */
  on: ISODate;
  /** What it cost then, and what that comes to in a year: what cancelling saves. */
  amount: Cents;
  cadence: Cadence;
  yearly: Cents;
  /** Charges from the shop that came after it was cancelled (and the grace): each one shouldn't have. */
  chargedSince: { id: string; date: ISODate; amount: Cents }[];
  cancel: CancelLink | null;
};

/** A repeating charge that isn't on the list, which the person can say is a subscription. */
export type OtherCharge = { key: string; name: string; amount: Cents; cadence: Cadence; variable: boolean; nextDate: ISODate; streamId: string };

export type Subscriptions = {
  /** Most expensive first, by what each costs a month. */
  active: SubscriptionRow[];
  /** The latest cancelled first. */
  cancelled: CancelledRow[];
  /** Other money going out on a rhythm (bills, a loan), most expensive first. */
  others: OtherCharge[];
  /** Every active subscription, added up: a month, and a year. */
  monthly: Cents;
  yearly: Cents;
  /** For each of Apple and Google that billed the person in the last APP_STORE_DAYS: how many charges, and what they came to. */
  appStores: { store: AppStore; charges: number; total: Cents }[];
};

const EMPTY_NOTES: SubscriptionNotes = { marks: {}, own: [] };

/** A subscription added by hand, the next charge rolled on past today. */
function nextOwn(next: ISODate, cadence: OwnCadence, today: ISODate): ISODate {
  let d = next;
  for (let k = 1; d < today && k < 600; k++) d = nthAfter(next, cadence, k);
  return d;
}

const yearlyOf = (amount: Cents, cadence: Cadence) => amount * perYear(cadence);
const byMonthly = (a: { monthly: Cents; name: string }, b: { monthly: Cents; name: string }) => b.monthly - a.monthly || a.name.localeCompare(b.name);

export function subscriptionsFor(streams: RecurringStream[], txns: Transaction[], notes: SubscriptionNotes | null | undefined, today: ISODate): Subscriptions {
  const { marks, own } = notes ?? EMPTY_NOTES;
  const lines = wholeLines(txns);
  const byId = new Map(lines.map((t) => [t.id, t]));
  const active: SubscriptionRow[] = [];
  const others: OtherCharge[] = [];

  for (const s of streams) {
    if (s.amount >= 0 || s.kind === "income" || s.kind === "transfer") continue;
    const key = ruleKey(s.merchant);
    if (key === null) continue;
    const mark = Object.hasOwn(marks, key) ? marks[key]! : null;
    // Cancelled: on the cancelled list, from the mark, whether or not it still looks like it's going.
    if (mark?.cancelled) continue;
    const amount = -s.amount;
    const found = s.kind === "subscription" || (isLong(s.cadence) && looksLikeSubscription(s.category, amount, s.variable));
    const counts = mark?.is ?? found;
    if (!counts) {
      others.push({ key, name: s.merchant, amount, cadence: s.cadence, variable: s.variable, nextDate: s.nextDate, streamId: s.id });
      continue;
    }
    const charges = s.transactionIds.map((id) => byId.get(id)).filter((t): t is Transaction => t !== undefined);
    const first = charges.reduce<ISODate | null>((d, t) => (d === null || t.date < d ? t.date : d), null);
    const started = first !== null && daysBetween(first, today) <= NEW_DAYS ? first : null;
    const afterTrial =
      started !== null &&
      lines.some((t) => t.amount <= 0 && t.amount >= -TRIAL_MAX && !t.pending && t.date < started && t.date >= addDays(started, -TRIAL_DAYS) && ruleKey(t.merchant) === key);
    active.push({
      key,
      name: s.merchant,
      amount,
      cadence: s.cadence,
      monthly: monthlyCost(s),
      yearly: yearlyOf(amount, s.cadence),
      nextDate: s.nextDate,
      lastDate: s.lastDate,
      source: mark?.is === true && !found ? "marked" : "found",
      priceChange: s.priceChange ? { from: -s.priceChange.from, to: -s.priceChange.to, date: s.priceChange.date } : null,
      started,
      afterTrial,
      billedBy: appStoreOf(s.merchant),
      cancel: cancelLinkFor(s.merchant),
      streamId: s.id,
      transactionIds: s.transactionIds,
    });
  }

  for (const o of own) {
    active.push({
      key: o.id,
      name: o.name,
      amount: o.amount,
      cadence: o.cadence,
      monthly: Math.round((o.amount * perYear(o.cadence)) / 12),
      yearly: yearlyOf(o.amount, o.cadence),
      nextDate: nextOwn(o.next, o.cadence, today),
      lastDate: null,
      source: "added",
      priceChange: null,
      started: null,
      afterTrial: false,
      billedBy: appStoreOf(o.name),
      cancel: cancelLinkFor(o.name),
      streamId: null,
      transactionIds: [],
    });
  }

  const cancelled: CancelledRow[] = [];
  for (const [key, mark] of Object.entries(marks)) {
    if (!mark.cancelled) continue;
    const { on, amount, cadence } = mark.cancelled;
    const after = addDays(on, CANCEL_GRACE_DAYS);
    const chargedSince = lines
      .filter((t) => t.amount < 0 && !t.pending && t.date > after && ruleKey(t.merchant) === key)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((t) => ({ id: t.id, date: t.date, amount: -t.amount }));
    cancelled.push({ key, name: mark.name, on, amount, cadence, yearly: yearlyOf(amount, cadence), chargedSince, cancel: cancelLinkFor(mark.name) });
  }
  cancelled.sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : a.name.localeCompare(b.name)));

  active.sort(byMonthly);
  others.sort((a, b) => b.amount * perYear(b.cadence) - a.amount * perYear(a.cadence) || a.name.localeCompare(b.name));
  const monthly = active.reduce((s, r) => s + r.monthly, 0);
  const since = addDays(today, -APP_STORE_DAYS);
  const appStores = (["apple", "google"] as const)
    .map((store) => {
      const billed = lines.filter((t) => t.amount < 0 && !t.pending && t.date > since && t.date <= today && appStoreOf(t.merchant) === store);
      return { store, charges: billed.length, total: billed.reduce((s, t) => s - t.amount, 0) };
    })
    .filter((x) => x.charges > 0);
  return { active, cancelled, others, monthly, yearly: active.reduce((s, r) => s + r.yearly, 0), appStores };
}
