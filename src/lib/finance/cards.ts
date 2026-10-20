// src/lib/finance/cards.ts
//
// A person's credit cards, as the Cards page shows them: what each owes
// against its limit, when its statement closes, what's due, the interest it
// has charged and its annual fee. One reading for the page and the
// connectors.
//
// Usage is what the bureaus see: the balance on the statement, against the
// limit. Before a statement closes, paying the card down lowers the balance
// it reports, which is what `payToReach` works out: from today's balance,
// what paying before the next close would bring the reported share under the
// next of the two levels people usually go by (30%, then 10%). It describes
// what a payment would do; it never says to make one.
//
// A card's limit comes from the bank with its balance; its statement date and
// what's due come from the lender (Plaid Liabilities), when Prism reads them.
// The next close is a month after the last one: cards close on the same day
// each month, near enough to plan by.
//
// Pure: reads the accounts and the transactions.

import { addDays, addMonths, daysBetween } from "./dates";
import { isInterestCharge } from "./payoff";
import type { Account, Cents, ISODate, Transaction } from "./types";

/** The shares of a limit people usually aim to report under, highest first. */
export const USAGE_LEVELS = [0.3, 0.1] as const;
/** How far back an annual fee is still this year's. */
const FEE_DAYS = 400;
const FEE_WORDS = /\b(annual (membership )?fee|membership fee|annual card fee)\b/i;

export type CardRow = {
  id: string;
  name: string;
  mask: string | null;
  institutionId: string;
  /** What's owed today, positive. A card in credit owes nothing. */
  owed: Cents;
  limit: Cents | null;
  /** Owed over the limit (0.15 is 15%); null without a limit. */
  usage: number | null;
  /** The last statement's date, and the next one's, a month on. */
  statementDate: ISODate | null;
  nextClose: ISODate | null;
  /** What paying before the next close would take for the balance it reports to be at most `level` of the limit, from today's balance. */
  payToReach: { level: number; amount: Cents; by: ISODate | null } | null;
  dueDate: ISODate | null;
  minimumPayment: Cents | null;
  statementBalance: Cents | null;
  apr: number | null;
  overdue: boolean;
  /** Interest charged in the last 12 months and since January, with the lines it came from. */
  interest: { last12: Cents; thisYear: Cents; ids: string[] };
  /** Its latest annual fee, within the last year or so. */
  annualFee: { amount: Cents; date: ISODate; id: string } | null;
};

export type Cards = {
  /** The most owed first. */
  cards: CardRow[];
  owed: Cents;
  /** Every limit the banks report, added up, and what's owed on those cards over it. */
  limits: Cents;
  usage: number | null;
  interest12: Cents;
  fees12: Cents;
};

/** The next statement after the last: a month on, rolled past today. */
function nextCloseAfter(last: ISODate, today: ISODate): ISODate {
  let d = last;
  for (let k = 1; d <= today && k < 24; k++) d = addMonths(last, k);
  return d;
}

/** What paying before the next close would take to report at most the next level down; null when it's already under 10%. */
function payToReachOf(owed: Cents, limit: Cents | null, by: ISODate | null): CardRow["payToReach"] {
  if (!limit || owed <= 0) return null;
  const usage = owed / limit;
  const level = USAGE_LEVELS.find((l) => usage > l);
  if (level === undefined) return null;
  return { level, amount: owed - Math.floor(limit * level), by };
}

export function cardsFor(accounts: Account[], txns: Transaction[], today: ISODate): Cards {
  const year = `${today.slice(0, 4)}-01-01`;
  const since12 = addDays(today, -365);
  const cards = accounts
    .filter((a) => a.kind === "credit")
    .map((a): CardRow => {
      const owed = Math.max(0, -a.balance);
      const limit = a.creditLimit && a.creditLimit > 0 ? a.creditLimit : null;
      const l = a.liability;
      const statementDate = l?.statementDate ?? null;
      const nextClose = statementDate ? nextCloseAfter(statementDate, today) : null;
      const own = txns.filter((t) => t.accountId === a.id && !t.pending);
      const interestLines = own.filter((t) => t.date > since12 && t.date <= today && isInterestCharge(t));
      const fee = own
        .filter((t) => t.amount < 0 && FEE_WORDS.test(t.merchant) && daysBetween(t.date, today) <= FEE_DAYS)
        .sort((x, y) => (x.date < y.date ? 1 : -1))[0];
      return {
        id: a.id,
        name: a.name,
        mask: a.mask,
        institutionId: a.institutionId,
        owed,
        limit,
        usage: limit ? owed / limit : null,
        statementDate,
        nextClose,
        payToReach: payToReachOf(owed, limit, nextClose),
        dueDate: l?.dueDate ?? null,
        minimumPayment: l?.minimumPayment ?? null,
        statementBalance: l?.statementBalance ?? null,
        apr: l?.apr ?? null,
        overdue: l?.overdue ?? false,
        interest: {
          last12: interestLines.reduce((s, t) => s - t.amount, 0),
          thisYear: interestLines.filter((t) => t.date >= year).reduce((s, t) => s - t.amount, 0),
          ids: interestLines.map((t) => t.id),
        },
        annualFee: fee ? { amount: -fee.amount, date: fee.date, id: fee.id } : null,
      };
    })
    .sort((x, y) => y.owed - x.owed || x.name.localeCompare(y.name));
  const limited = cards.filter((c) => c.limit !== null);
  const limits = limited.reduce((s, c) => s + c.limit!, 0);
  const owedOnLimited = limited.reduce((s, c) => s + c.owed, 0);
  return {
    cards,
    owed: cards.reduce((s, c) => s + c.owed, 0),
    limits,
    usage: limits > 0 ? owedOnLimited / limits : null,
    interest12: cards.reduce((s, c) => s + c.interest.last12, 0),
    fees12: cards.reduce((s, c) => s + (c.annualFee && daysBetween(c.annualFee.date, today) <= 365 ? c.annualFee.amount : 0), 0),
  };
}
