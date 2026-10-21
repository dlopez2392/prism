// src/lib/finance/business.ts
//
// The person's business accounts, summed on their own. An account marked as
// business (finance/details.ts) is kept out of every personal total, like one
// left out, so a business's sales and costs never pass for the person's pay
// and spending; here it's what's in those accounts, and what came in and went
// out of them this month, last month and the month before. The card on Cash
// flow and the connector read it from here.
//
// Money in and out are every line in a business account, transfers included:
// what the owner pays themselves leaves the business as surely as a supplier's
// bill does. A transfer between two business accounts is the business moving
// its own money, so it counts neither way.
//
// Pure: reads the accounts and the transactions.

import { addDays, addMonths, monthKey, startOfMonth } from "./dates";
import { wholeLines } from "./details";
import type { Account, Cents, ISODate, Transaction } from "./types";

export type BusinessMonth = { month: string; from: ISODate; to: ISODate; moneyIn: Cents; moneyOut: Cents; net: Cents };

export type Business = {
  accounts: Account[];
  /** What the business accounts hold now (a card's debt counts against it). */
  balance: Cents;
  /** This month so far, then last month and the month before, each whole. */
  months: BusinessMonth[];
};

/**
 * Every settled line in the business accounts `ids` names, as the bank sent
 * it (a split joined back), up to `today`: a transfer between two of them
 * left out, since that's the business moving its own money.
 */
export function businessLines(ids: Iterable<string>, txns: Transaction[], today: ISODate): Transaction[] {
  const mine = new Set(ids);
  const lines = wholeLines(txns).filter((t) => mine.has(t.accountId) && !t.pending && t.date <= today);
  // Pairs of opposite lines on the same day between two business accounts.
  const internal = new Set<string>();
  for (const t of lines) {
    if (t.category !== "transfer" || internal.has(t.id)) continue;
    const other = lines.find((o) => o.id !== t.id && !internal.has(o.id) && o.category === "transfer" && o.accountId !== t.accountId && o.amount === -t.amount && o.date === t.date);
    if (other) {
      internal.add(t.id);
      internal.add(other.id);
    }
  }
  return lines.filter((t) => !internal.has(t.id));
}

/** Null when the person has marked no account as business. */
export function businessFor(hidden: Account[], ids: string[] | undefined, txns: Transaction[], today: ISODate): Business | null {
  const marked = new Set(ids ?? []);
  const accounts = hidden.filter((a) => marked.has(a.id));
  if (!accounts.length) return null;
  const lines = businessLines(accounts.map((a) => a.id), txns, today);
  const thisMonth = startOfMonth(today);
  const months = [0, -1, -2].map((n) => {
    const from = addMonths(thisMonth, n);
    const to = n === 0 ? today : addDays(addMonths(from, 1), -1);
    let moneyIn = 0;
    let moneyOut = 0;
    for (const t of lines) {
      if (t.date < from || t.date > to) continue;
      if (t.amount > 0) moneyIn += t.amount;
      else moneyOut -= t.amount;
    }
    return { month: monthKey(from), from, to, moneyIn, moneyOut, net: moneyIn - moneyOut };
  });
  return { accounts, balance: accounts.reduce((s, a) => s + a.balance, 0), months };
}
