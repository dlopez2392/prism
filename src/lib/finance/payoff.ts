// src/lib/finance/payoff.ts
//
// Paying off what you owe: which debt the extra goes to first, and when each
// one is gone. The two orders people use:
//   - highest rate first ("avalanche"): the least interest paid;
//   - smallest balance first ("snowball"): the first debt gone soonest.
// Either way, every debt still owed gets its own monthly payment, the extra
// goes to the one first in line, and when a debt is gone its payment joins
// the extra. That roll-over is what makes either order work. Paying only
// what each one asks, with no roll-over, is the yardstick.
//
// Pure: the card on Net worth runs it in the browser as the person types, and
// `plan_debt_payoff` runs the same arithmetic for Claude and ChatGPT. It
// says what each order would do; it never says which to pick.

import { addDays, addMonths, monthKey, startOfMonth } from "./dates";
import type { Account, Cents, ISODate, Transaction } from "./types";

/** One debt in a plan: what's owed now (positive), its yearly rate as a percentage, and what it's paid each month. */
export type Debt = { id: string; name: string; owed: Cents; apr: number; payment: Cents };

export type PayoffOrder = "avalanche" | "snowball";

export type Cleared = { id: string; name: string; months: number | null; month: string | null };

export type PayoffPlan = {
  /** Months until every debt is gone, or null when it never happens at these payments (or not within PAYOFF_MAX_MONTHS). */
  months: number | null;
  /** The month the last payment lands ("2029-03"), or null. */
  debtFree: string | null;
  /** Interest paid until then (or until the plan stops, when it never ends). */
  interest: Cents;
  /** Each debt in the order it's gone; any never gone last, with null months. */
  cleared: Cleared[];
  /** What's owed in all at the end of each month; index 0 is today. */
  owed: Cents[];
  /** Debts whose payment doesn't cover the interest they charge, so they never shrink. */
  stuck: string[];
};

/** Fifty years: past that, "never" is the honest answer. */
export const PAYOFF_MAX_MONTHS = 600;
export const PAYOFF_LIMITS = {
  /** A yearly rate, as a percentage. */
  apr: 100,
  /** What one debt may be: $10 million. */
  owed: 1_000_000_000,
  /** A monthly payment, or the extra: $1 million. */
  payment: 100_000_000,
  debts: 20,
} as const;

/** The order the extra goes in: the highest rate (or the smallest balance) first, then the other, then the name. */
export function payoffOrder(debts: Debt[], order: PayoffOrder): Debt[] {
  return [...debts].sort((a, b) =>
    order === "avalanche" ? b.apr - a.apr || a.owed - b.owed || a.name.localeCompare(b.name) : a.owed - b.owed || b.apr - a.apr || a.name.localeCompare(b.name),
  );
}

/**
 * Month by month: interest on what's still owed, then each debt's own
 * payment, then (in an order) the extra plus the payments of debts already
 * gone, to the first in line. "minimums" pays each only its own, with no
 * extra and no roll-over. Interest is charged monthly at a twelfth of the
 * yearly rate, to the cent.
 */
export function planPayoff(debts: Debt[], extra: Cents, order: PayoffOrder | "minimums", today: ISODate): PayoffPlan {
  const line = order === "minimums" ? debts : payoffOrder(debts, order);
  const left = new Map(line.map((d) => [d.id, d.owed]));
  const owedNow = () => [...left.values()].reduce((s, b) => s + b, 0);
  const rollOver = order !== "minimums";
  // With a roll-over the whole pot is spent every month while anything is owed: the extra and every debt's own payment.
  const pot = extra + line.reduce((s, d) => s + d.payment, 0);
  const start = startOfMonth(today);
  const cleared: Cleared[] = [];
  const stuck = new Set<string>();
  const owed = [owedNow()];
  let interest = 0;
  let months: number | null = null;

  for (let m = 1; m <= PAYOFF_MAX_MONTHS; m++) {
    const open = line.filter((d) => left.get(d.id)! > 0);
    // Only debts that never shrink are left: nothing more will be paid off.
    if (!open.some((d) => !stuck.has(d.id))) break;
    let charged = 0;
    for (const d of open) {
      const i = Math.round((left.get(d.id)! * d.apr) / 1200);
      // Paid only its own and that doesn't cover its interest: it grows every month from here.
      if (!rollOver && d.payment <= i) stuck.add(d.id);
      left.set(d.id, left.get(d.id)! + i);
      charged += i;
    }
    // In an order, a pot that doesn't cover the month's interest never gets anywhere.
    if (rollOver && pot <= charged) {
      for (const d of open) stuck.add(d.id);
      interest += charged;
      break;
    }
    interest += charged;
    let spare = pot;
    for (const d of open) {
      const pay = Math.min(d.payment, left.get(d.id)!);
      left.set(d.id, left.get(d.id)! - pay);
      spare -= pay;
    }
    if (rollOver) {
      for (const d of open) {
        if (spare <= 0) break;
        const pay = Math.min(spare, left.get(d.id)!);
        left.set(d.id, left.get(d.id)! - pay);
        spare -= pay;
      }
    }
    for (const d of open) {
      if (left.get(d.id) === 0) cleared.push({ id: d.id, name: d.name, months: m, month: monthKey(addMonths(start, m)) });
    }
    owed.push(owedNow());
    if (cleared.length === line.length) {
      months = m;
      break;
    }
  }
  for (const d of line) if (!cleared.some((c) => c.id === d.id)) cleared.push({ id: d.id, name: d.name, months: null, month: null });
  return { months, debtFree: months === null ? null : monthKey(addMonths(start, months)), interest, cleared, owed, stuck: [...stuck] };
}

/** Both orders and the yardstick, from the same debts and extra. `same` when both orders put the debts in the same line. */
export function comparePayoff(debts: Debt[], extra: Cents, today: ISODate) {
  const avalanche = planPayoff(debts, extra, "avalanche", today);
  const snowball = planPayoff(debts, extra, "snowball", today);
  const same = payoffOrder(debts, "avalanche").every((d, i) => d.id === payoffOrder(debts, "snowball")[i]!.id);
  return { avalanche, snowball, minimums: planPayoff(debts, 0, "minimums", today), same };
}

/** A yearly rate as a person types it ("6.9", "24.99%"): a percentage from 0 to 100, or null. */
export function parseRate(input: string): number | null {
  const s = input.trim().replace(/\s*%$/, "");
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(s)) return null;
  const n = Number(s);
  return n <= PAYOFF_LIMITS.apr ? n : null;
}

/** A plan's debts as a person typed them, or null when any isn't one Prism can plan with. */
export function validDebts(x: unknown): Debt[] | null {
  if (!Array.isArray(x) || x.length === 0 || x.length > PAYOFF_LIMITS.debts) return null;
  const out: Debt[] = [];
  const ids = new Set<string>();
  for (const raw of x) {
    const d = raw as Partial<Debt> | null;
    if (!d || typeof d.id !== "string" || !d.id || ids.has(d.id) || typeof d.name !== "string") return null;
    if (!Number.isSafeInteger(d.owed) || d.owed! <= 0 || d.owed! > PAYOFF_LIMITS.owed) return null;
    if (typeof d.apr !== "number" || !Number.isFinite(d.apr) || d.apr < 0 || d.apr > PAYOFF_LIMITS.apr) return null;
    if (!Number.isSafeInteger(d.payment) || d.payment! <= 0 || d.payment! > PAYOFF_LIMITS.payment) return null;
    ids.add(d.id);
    out.push({ id: d.id, name: d.name, owed: d.owed!, apr: d.apr, payment: d.payment! });
  }
  return out;
}

/** A card or a loan someone owes on, with what its lender says about it. */
export type DebtAccount = {
  id: string;
  name: string;
  mask: string | null;
  kind: "credit" | "loan";
  owed: Cents;
  /** The lender's rate and minimum, when Prism reads them; the person types them otherwise. */
  apr: number | null;
  payment: Cents | null;
  /** In the plan to start with: every loan, and a card only when it charged interest lately (one paid off each month carries no debt). */
  carried: boolean;
};

/** How far back an interest charge says a card carries a balance: two statements. */
export const INTEREST_DAYS = 65;
const INTEREST_WORDS = /\b(interest charge|interest charged|purchase interest|finance charge|interest on purchases)\b/i;

/** Did the account charge interest lately: the bank's own category, or a line that says so. */
export function chargedInterest(accountId: string, txns: Transaction[], today: ISODate): boolean {
  const since = addDays(today, -INTEREST_DAYS);
  return txns.some((t) => t.accountId === accountId && t.amount < 0 && t.date >= since && (t.interestCharge === true || INTEREST_WORDS.test(t.merchant)));
}

/** Every card and loan with something owed, the most owed first. */
export function debtAccounts(accounts: Account[], txns: Transaction[], today: ISODate): DebtAccount[] {
  return accounts
    .filter((a): a is Account & { kind: "credit" | "loan" } => (a.kind === "credit" || a.kind === "loan") && a.balance < 0)
    .map((a) => ({
      id: a.id,
      name: a.name,
      mask: a.mask,
      kind: a.kind,
      owed: -a.balance,
      apr: a.liability?.apr ?? null,
      payment: a.liability?.minimumPayment ?? null,
      carried: a.kind === "loan" || chargedInterest(a.id, txns, today),
    }))
    .sort((x, y) => y.owed - x.owed || x.name.localeCompare(y.name));
}
