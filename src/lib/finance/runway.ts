// src/lib/finance/runway.ts
//
// How long could you last: if the paychecks stopped today, how long the cash
// on hand would cover the person's spending. The card on Future and the
// connector read it from here.
//
// Cash is what's in checking and savings now (accounts left out of the
// totals aren't here at all). Investments (brokerage and crypto, never
// retirement, which costs penalties to take early) are counted only in a
// second figure, since selling them takes time and their value moves.
//
// A month's cost is the average over the last RUNWAY_MONTHS full months that
// have spending in them (fewer when the history is shorter): everything, and
// the ESSENTIALS alone (housing, food, transport, health, bills), the part
// that doesn't stop when the paychecks do. A loan whose payment the bank files
// as a transfer isn't spending, so its lender-reported payment is added to
// both, unless a spending line in the last LOAN_SEEN_DAYS already paid that
// amount (a loan filed as a bill is counted once, never twice).
//
// The months are cash ÷ cost: a description of the cushion, never advice.
//
// Pure: reads the accounts and the transactions.

import { isSpending } from "./cashflow";
import { addDays, addMonths, startOfMonth } from "./dates";
import type { Account, Cents, ISODate, SpendCategoryId, Transaction } from "./types";

/** Full months the cost is averaged over, at most. */
export const RUNWAY_MONTHS = 3;
/** The spending that goes on when the paychecks stop. */
export const ESSENTIALS: readonly SpendCategoryId[] = ["housing", "food", "transport", "health", "bills"];
/** A loan payment seen as spending within this many days is already counted. */
const LOAN_SEEN_DAYS = 45;
/** Days in an average month, for the date it would last until. */
const MONTH_DAYS = 30.44;

export type Runway = {
  /** Checking and savings now. */
  cash: Cents;
  /** Brokerage and crypto now (never retirement). */
  investments: Cents;
  /** Full months the costs are averaged over (1 to RUNWAY_MONTHS). */
  monthsMeasured: number;
  /** What a month costs: all spending, and the essentials alone, each with the loans added. */
  usual: Cents;
  essentials: Cents;
  /** The essentials by category, the most first, then each loan added. */
  essentialParts: { category: SpendCategoryId; amount: Cents }[];
  loans: { name: string; amount: Cents }[];
  /** How many months the cash lasts at each cost, and with investments at the essentials' cost. */
  months: { usual: number; essentials: number; withInvestments: number | null };
  /** About when the cash would run out, at each cost. */
  until: { usual: ISODate; essentials: ISODate };
};

/**
 * The whole months, oldest first, of the last RUNWAY_MONTHS before this one
 * that have spending in them: never one the history starts partway through,
 * which would make a month look cheaper than it was.
 */
function measuredMonths(txns: Transaction[], today: ISODate): ISODate[] {
  const thisMonth = startOfMonth(today);
  const first = txns.reduce<ISODate | null>((min, t) => (min === null || t.date < min ? t.date : min), null);
  const starts = Array.from({ length: RUNWAY_MONTHS }, (_, i) => addMonths(thisMonth, i - RUNWAY_MONTHS));
  return starts.filter((from) => {
    const to = addDays(addMonths(from, 1), -1);
    return first !== null && first <= addDays(from, 3) && txns.some((t) => t.date >= from && t.date <= to && isSpending(t));
  });
}

/** Null when there isn't a whole month of spending to measure, or nothing is spent. */
export function runwayFor(accounts: Account[], txns: Transaction[], today: ISODate): Runway | null {
  const months = measuredMonths(txns, today);
  if (!months.length) return null;
  const from = months[0]!;
  const to = addDays(startOfMonth(today), -1);
  const inMonths = (t: Transaction) => t.date >= from && t.date <= to && months.some((m) => t.date >= m && t.date < addMonths(m, 1));

  const byCategory = new Map<SpendCategoryId, Cents>();
  let all = 0;
  for (const t of txns) {
    if (!isSpending(t) || !inMonths(t)) continue;
    all -= t.amount;
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) - t.amount);
  }
  const n = months.length;
  const essentialParts = ESSENTIALS.map((category) => ({ category, amount: Math.round((byCategory.get(category) ?? 0) / n) }))
    .filter((p) => p.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  // A loan's payment the lender reports, when no recent spending line already paid it.
  const recent = txns.filter((t) => isSpending(t) && t.date > addDays(today, -LOAN_SEEN_DAYS) && t.date <= today);
  const loans = accounts
    .filter((a) => a.kind === "loan" && a.liability?.minimumPayment)
    .filter((a) => !recent.some((t) => Math.abs(-t.amount - a.liability!.minimumPayment!) <= 100))
    .map((a) => ({ name: a.name, amount: a.liability!.minimumPayment! }));
  const loanTotal = loans.reduce((s, l) => s + l.amount, 0);

  const usual = Math.round(all / n) + loanTotal;
  const essentials = essentialParts.reduce((s, p) => s + p.amount, 0) + loanTotal;
  if (usual <= 0 || essentials <= 0) return null;

  const cash = accounts.filter((a) => a.kind === "checking" || a.kind === "savings").reduce((s, a) => s + a.balance, 0);
  const investments = accounts.filter((a) => a.kind === "investment" || a.kind === "crypto").reduce((s, a) => s + Math.max(0, a.balance), 0);
  const have = Math.max(0, cash);
  const last = (perMonth: Cents) => have / perMonth;
  const until = (m: number) => addDays(today, Math.floor(m * MONTH_DAYS));
  const usualMonths = last(usual);
  const essentialMonths = last(essentials);
  return {
    cash,
    investments,
    monthsMeasured: n,
    usual,
    essentials,
    essentialParts,
    loans,
    months: { usual: usualMonths, essentials: essentialMonths, withInvestments: investments > 0 ? (have + investments) / essentials : null },
    until: { usual: until(usualMonths), essentials: until(essentialMonths) },
  };
}
