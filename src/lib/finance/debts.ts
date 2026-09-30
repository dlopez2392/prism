// src/lib/finance/debts.ts
//
// Cards and loans by what they ask for next, from the lender's own terms
// (Account.liability, read from Plaid Liabilities). Pure: every screen and
// the calendar and a connected app read the same answers from here.

import { addDays, daysBetween } from "./dates";
import { money, money0, shortDate } from "./format";
import type { RecurringStream } from "./recurring";
import type { Account, Cents, ISODate, Liability, Transaction } from "./types";

/** How far ahead a due date is worth showing: past the next statement of any monthly bill. */
export const DUE_WINDOW_DAYS = 45;

export type DuePayment = { account: Account; liability: Liability & { dueDate: ISODate } };

/** Every card and loan with a payment due from today to `days` ahead, soonest first. */
export function paymentsDue(accounts: Account[], today: ISODate, days = DUE_WINDOW_DAYS): DuePayment[] {
  const last = addDays(today, days);
  return accounts
    .flatMap((account) => {
      const l = account.liability;
      return l?.dueDate && l.dueDate >= today && l.dueDate <= last ? [{ account, liability: { ...l, dueDate: l.dueDate } }] : [];
    })
    .sort((a, b) => (a.liability.dueDate < b.liability.dueDate ? -1 : a.liability.dueDate > b.liability.dueDate ? 1 : a.account.name.localeCompare(b.account.name)));
}

/** "today", "tomorrow", "in 5 days". */
export function dueIn(date: ISODate, today: ISODate): string {
  const n = daysBetween(today, date);
  return n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
}

/** "24.99% APR", "6.5% interest": a card's APR, a loan's rate. */
export function rateText(apr: number, kind: Account["kind"]): string {
  const pct = `${Number(apr.toFixed(2))}%`;
  return kind === "credit" ? `${pct} APR` : `${pct} interest`;
}

/** The account's terms in one line: "Due Oct 14 · $35 minimum · 24.99% APR". Only what the lender told us. */
export function termsLine(account: Account): string | null {
  const l = account.liability;
  if (!l) return null;
  const parts = [
    l.dueDate ? `Due ${shortDate(l.dueDate)}` : null,
    l.minimumPayment !== null ? `${money(l.minimumPayment)} minimum` : null,
    l.apr !== null ? rateText(l.apr, account.kind) : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? parts.join(" · ") : null;
}

/** "Statement $1,240" when the lender gives one: what clears a card without interest. */
export function statementText(l: Liability): string | null {
  return l.statementBalance !== null ? `Statement ${money0(l.statementBalance)}` : null;
}

/** How far apart the two sides of one payment may post (money out of checking, money into the card). */
const POSTING_DAYS = 3;

/**
 * Which repeating payment pays which card or loan: every payment shows up
 * twice, as money out of the paying account and as a payment INTO the card,
 * for the same amount within a few days. A stream whose payments match the
 * card's incoming payments at least twice is that card's payment, and its
 * next occurrence becomes the lender's own: the due date, and the statement
 * balance or the minimum, whichever is closer to what the person has been
 * paying. Everything else is left as it was found.
 */
export function withLenderTerms(streams: RecurringStream[], accounts: Account[], txns: Transaction[], today: ISODate): RecurringStream[] {
  const byId = new Map(txns.map((t) => [t.id, t]));
  const taken = new Set<string>();
  const lender = new Map<string, RecurringStream["lender"]>();
  for (const account of accounts) {
    const l = account.liability;
    if (!l?.dueDate || l.dueDate < today || (l.statementBalance === null && l.minimumPayment === null)) continue;
    const incoming = txns.filter((t) => t.accountId === account.id && t.amount > 0 && !t.pending);
    let best: { stream: RecurringStream; matches: number } | null = null;
    for (const s of streams) {
      if (s.amount >= 0 || s.accountId === account.id || taken.has(s.id)) continue;
      const matches = s.transactionIds.filter((id) => {
        const out = byId.get(id);
        return out && incoming.some((t) => t.amount === -out.amount && Math.abs(daysBetween(out.date, t.date)) <= POSTING_DAYS);
      }).length;
      if (matches >= 2 && (!best || matches > best.matches)) best = { stream: s, matches };
    }
    if (!best) continue;
    taken.add(best.stream.id);
    lender.set(best.stream.id, { accountId: account.id, dueDate: l.dueDate, amount: -payingAmount(l, Math.abs(best.stream.amount)) });
  }
  return lender.size ? streams.map((s) => (lender.has(s.id) ? { ...s, lender: lender.get(s.id) } : s)) : streams;
}

/** The statement balance or the minimum, whichever is closer to what the person usually pays. */
function payingAmount(l: Liability, usual: Cents): Cents {
  const options = [l.statementBalance, l.minimumPayment].filter((x): x is Cents => x !== null);
  return options.reduce((best, x) => (Math.abs(x - usual) < Math.abs(best - usual) ? x : best));
}
