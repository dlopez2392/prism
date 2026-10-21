// src/lib/finance/refunds.ts
//
// Money on its way back to the person, in one place: refunds they're waiting
// on (a purchase they returned, a fee they asked to have back, a charge that
// went through twice or came after they cancelled), what friends owe them for
// purchases they marked (finance/details.ts), and money they may be owed but
// haven't asked for yet. The Refunds page, its insight and the connector read
// it from here.
//
// A refund the person is waiting on (a RefundMark, kept sealed in their
// account) is found come back on its own: a line of money in for exactly the
// amount, on or after the purchase's day and within MATCH_DAYS of it, from the
// same shop by name, or in the same account with words that say it's a
// refund (a fee's reversal rarely carries the fee's name). Each line of money
// in pays back one refund only, the oldest waiting first. When it came back
// another way (store credit, cash) the person says so, and that day counts.
//
// A refund still out past LATE_AFTER days for its kind is late: that's when
// it's worth chasing. Fees usually come back within days, a return within
// two weeks, and a card dispute takes up to a statement or two.
//
// What the person may be owed without having asked: a fee in the last
// SUGGEST_DAYS that hasn't come back, a charge that may have gone through
// twice (fees.ts), and a charge that came after they cancelled
// (subscriptions.ts). Only suggestions: Prism never asks anyone for money.
//
// Pure: reads the transactions and the marks.

import { addDays, daysBetween } from "./dates";
import { wholeLines, type RefundKind, type RefundMark } from "./details";
import { feeKind, feesFor, REFUND_WORDS } from "./fees";
import { normalizeMerchant } from "./merchant";
import type { Subscriptions } from "./subscriptions";
import type { Cents, ISODate, Owed, Transaction } from "./types";

/** Days a refund of each kind usually takes; past them it's late. */
export const LATE_AFTER: Record<RefundKind, number> = { fee: 10, return: 14, other: 14, double: 30, "after-cancel": 30 };
/** A refund is looked for this long after the purchase. */
export const MATCH_DAYS = 120;
/** Money that may be owed is suggested for this long after the charge. */
export const SUGGEST_DAYS = 60;
/** Refunds that came back are listed for this long. */
const BACK_DAYS = 365;

export type Waiting = {
  /** The line it's for, as the bank sent it. */
  id: string;
  name: string;
  /** The purchase's day. */
  date: ISODate;
  amount: Cents;
  kind: RefundKind;
  /** The day the person started waiting. */
  asked: ISODate;
  /** When it's late from. */
  due: ISODate;
  /** Days past due, or 0 while it's on time. */
  late: number;
};

export type CameBack = {
  id: string;
  name: string;
  amount: Cents;
  kind: RefundKind;
  /** The day it came back. */
  on: ISODate;
  /** The line that paid it back, or null when the person said it came back another way. */
  via: { id: string; date: ISODate } | null;
};

export type MayBeOwed = { id: string; name: string; date: ISODate; amount: Cents; kind: "fee" | "double" | "after-cancel"; accountId: string };

export type Refunds = {
  /** Waiting, the latest first among the late, then the soonest due. */
  waiting: Waiting[];
  /** Come back in the last year, the latest first. */
  back: CameBack[];
  /** What friends owe for purchases the person marked, oldest first. */
  owed: { t: Transaction; owed: Owed }[];
  /** Money that may be owed, not yet asked for, the latest first. */
  suggestions: MayBeOwed[];
  waitingTotal: Cents;
  owedTotal: Cents;
  /** How many refunds are late. */
  late: number;
  /** What came back since January 1. */
  backThisYear: Cents;
};

/** The line of money in that paid a refund back, among those not yet used, or null. */
function cameBackBy(mark: RefundMark, purchase: Transaction | undefined, credits: Transaction[], used: Set<string>): Transaction | null {
  const shop = normalizeMerchant(mark.name);
  return (
    credits.find(
      (r) =>
        !used.has(r.id) &&
        r.amount === mark.amount &&
        r.date >= mark.date &&
        daysBetween(mark.date, r.date) <= MATCH_DAYS &&
        (normalizeMerchant(r.merchant) === shop || (purchase !== undefined && r.accountId === purchase.accountId && (REFUND_WORDS.test(r.merchant) || r.bankFee !== undefined))),
    ) ?? null
  );
}

export function refundsFor(txns: Transaction[], marks: Record<string, RefundMark>, subscriptions: Subscriptions | null, today: ISODate): Refunds {
  const lines = wholeLines(txns).filter((t) => !t.pending && t.date <= today);
  const byId = new Map(lines.map((t) => [t.id, t]));
  const credits = lines.filter((t) => t.amount > 0).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const used = new Set<string>();

  const waiting: Waiting[] = [];
  const back: CameBack[] = [];
  // The oldest purchase first, so an earlier refund takes the earlier line of money in.
  const ordered = Object.entries(marks).sort(([, a], [, b]) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const [id, mark] of ordered) {
    const via = cameBackBy(mark, byId.get(id), credits, used);
    if (via) used.add(via.id);
    if (via || mark.got) {
      const on = via?.date ?? mark.got!;
      if (daysBetween(on, today) <= BACK_DAYS) back.push({ id, name: mark.name, amount: mark.amount, kind: mark.kind, on, via: via ? { id: via.id, date: via.date } : null });
      continue;
    }
    const due = addDays(mark.asked, LATE_AFTER[mark.kind]);
    waiting.push({ id, name: mark.name, date: mark.date, amount: mark.amount, kind: mark.kind, asked: mark.asked, due, late: Math.max(0, daysBetween(due, today)) });
  }
  waiting.sort((a, b) => b.late - a.late || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  back.sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0));

  const owed = txns
    .filter((t): t is Transaction & { owed: Owed } => t.owed !== undefined && t.owed.paid === null)
    .map((t) => ({ t, owed: t.owed }))
    .sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : 0));

  const since = addDays(today, -SUGGEST_DAYS);
  const marked = (id: string) => Object.hasOwn(marks, id);
  const suggestions: MayBeOwed[] = [];
  const f = feesFor(txns, today);
  for (const fee of f.fees) {
    if (fee.refund || fee.date <= since || marked(fee.id)) continue;
    suggestions.push({ id: fee.id, name: fee.name, date: fee.date, amount: fee.amount, kind: "fee", accountId: fee.accountId });
  }
  for (const d of f.doubles) {
    // The second of the two is the one to ask back.
    const id = d.ids.at(-1)!;
    if (d.date <= since || d.ids.some(marked)) continue;
    suggestions.push({ id, name: d.merchant, date: d.date, amount: d.amount, kind: "double", accountId: d.accountId });
  }
  for (const c of subscriptions?.cancelled ?? []) {
    for (const charge of c.chargedSince) {
      const line = byId.get(charge.id);
      if (!line || charge.date <= since || marked(charge.id)) continue;
      suggestions.push({ id: charge.id, name: c.name, date: charge.date, amount: charge.amount, kind: "after-cancel", accountId: line.accountId });
    }
  }
  suggestions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.amount - a.amount));

  const year = `${today.slice(0, 4)}-01-01`;
  return {
    waiting,
    back,
    owed,
    suggestions,
    waitingTotal: waiting.reduce((s, w) => s + w.amount, 0),
    owedTotal: owed.reduce((s, o) => s + o.owed.amount, 0),
    late: waiting.filter((w) => w.late > 0).length,
    backThisYear: back.filter((b) => b.on >= year).reduce((s, b) => s + b.amount, 0),
  };
}

/** The kind a refund for a line most likely is: a fee's reversal for a fee, otherwise a return. */
export function refundKindOf(t: Parameters<typeof feeKind>[0]): RefundKind {
  return feeKind(t) ? "fee" : "return";
}
