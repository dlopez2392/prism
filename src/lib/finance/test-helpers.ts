// apps/finance/src/lib/finance/test-helpers.ts — fixtures for the unit suite.
import type { CategoryId, Transaction } from "./types";

let n = 0;

export function tx(
  date: string,
  amount: number,
  merchant: string,
  category: CategoryId,
  accountId = "chk",
): Transaction {
  return { id: `t${++n}`, accountId, date, amount, merchant, category, pending: false };
}

/** The same charge on the same day of each listed month. */
export function monthly(
  months: string[],
  day: number,
  amount: number | number[],
  merchant: string,
  category: CategoryId,
  accountId = "chk",
): Transaction[] {
  return months.map((m, i) =>
    tx(`${m}-${String(day).padStart(2, "0")}`, Array.isArray(amount) ? amount[i]! : amount, merchant, category, accountId),
  );
}
