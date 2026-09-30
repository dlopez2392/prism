// src/lib/plaid/liabilities.ts
//
// What a card or a loan actually asks for: its due date, minimum payment,
// statement balance and interest rate, from Plaid Liabilities. The person
// consented to it when they linked the bank, but Plaid bills for it from the
// first read, so Prism reads it only when the operator has switched it on
// (PLAID_LIABILITIES=on), only for banks that hold a card or a loan, and at
// most once a day (Plaid itself refreshes it about daily). What is read is
// kept, slimmed, inside the bank's sealed sync copy.
//
// Pure apart from the Plaid call, which takes an injectable fetch.

import { toCents } from "./map";
import { plaidRequest, type Env, type PlaidAccount, type PlaidConfig } from "./client";
import type { ISODate, Liability } from "@/lib/finance/types";

/** One card or loan, as kept: Plaid's own numbers (dollars), only the fields Prism shows. */
export type StoredLiability = {
  account_id: string;
  due: ISODate | null;
  minimum: number | null;
  statement: number | null;
  /** The purchase APR on a card, the interest rate on a loan: a percentage. */
  apr: number | null;
  overdue: boolean;
};

/** A bank's liabilities as of `at`. An empty list is an answer too: nothing to show, and nothing to ask again today. */
export type StoredLiabilities = { at: string; list: StoredLiability[] };

/** Plaid refreshes Liabilities about once a day, so asking more often only costs. */
export const LIABILITIES_FRESH_MS = 24 * 60 * 60_000;

/** Reading Liabilities is billed, so it is off until the operator turns it on. */
export function liabilitiesEnabled(env: Env = process.env): boolean {
  return env.PLAID_LIABILITIES?.trim() === "on";
}

/** Only a bank holding a card or a loan has anything to read; asking any other would bill for nothing. */
export function holdsDebt(accounts: PlaidAccount[]): boolean {
  return accounts.some((a) => a.type === "credit" || a.type === "loan");
}

export function liabilitiesStale(stored: StoredLiabilities | null | undefined, now = Date.now()): boolean {
  if (!stored) return true;
  const at = Date.parse(stored.at);
  return !Number.isFinite(at) || now - at > LIABILITIES_FRESH_MS;
}

type Apr = { apr_percentage?: number | null; apr_type?: string | null };
type RawCredit = {
  account_id: string | null;
  aprs?: Apr[] | null;
  is_overdue?: boolean | null;
  last_statement_balance?: number | null;
  minimum_payment_amount?: number | null;
  next_payment_due_date?: string | null;
};
type RawMortgage = {
  account_id: string | null;
  next_payment_due_date?: string | null;
  next_monthly_payment?: number | null;
  interest_rate?: { percentage?: number | null } | null;
  past_due_amount?: number | null;
};
type RawStudent = {
  account_id: string | null;
  minimum_payment_amount?: number | null;
  next_payment_due_date?: string | null;
  interest_rate_percentage?: number | null;
  is_overdue?: boolean | null;
  last_statement_balance?: number | null;
};
export type RawLiabilities = { credit?: RawCredit[] | null; mortgage?: RawMortgage[] | null; student?: RawStudent[] | null };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (x: unknown): ISODate | null => (typeof x === "string" && DATE.test(x) ? x : null);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** A card's purchase APR, which is what its balance grows at; else the first one listed. */
function purchaseApr(aprs: Apr[] | null | undefined): number | null {
  const list = aprs ?? [];
  return num((list.find((a) => a.apr_type === "purchase_apr") ?? list[0])?.apr_percentage);
}

/** Plaid's answer, down to what Prism shows. */
export function slimLiabilities(raw: RawLiabilities): StoredLiability[] {
  const out: StoredLiability[] = [];
  for (const c of raw.credit ?? []) {
    if (!c.account_id) continue;
    out.push({
      account_id: c.account_id,
      due: date(c.next_payment_due_date),
      minimum: num(c.minimum_payment_amount),
      statement: num(c.last_statement_balance),
      apr: purchaseApr(c.aprs),
      overdue: c.is_overdue === true,
    });
  }
  for (const m of raw.mortgage ?? []) {
    if (!m.account_id) continue;
    out.push({
      account_id: m.account_id,
      due: date(m.next_payment_due_date),
      minimum: num(m.next_monthly_payment),
      statement: null,
      apr: num(m.interest_rate?.percentage),
      overdue: (num(m.past_due_amount) ?? 0) > 0,
    });
  }
  for (const s of raw.student ?? []) {
    if (!s.account_id) continue;
    out.push({
      account_id: s.account_id,
      due: date(s.next_payment_due_date),
      minimum: num(s.minimum_payment_amount),
      statement: num(s.last_statement_balance),
      apr: num(s.interest_rate_percentage),
      overdue: s.is_overdue === true,
    });
  }
  return out;
}

/** A stored copy's liabilities, or null when they aren't there or aren't what Prism wrote. */
export function validLiabilities(x: unknown): StoredLiabilities | null {
  const s = x as Partial<StoredLiabilities> | null | undefined;
  if (!s || typeof s.at !== "string" || !Array.isArray(s.list)) return null;
  const ok = s.list.every(
    (l) =>
      l &&
      typeof l.account_id === "string" &&
      (l.due === null || date(l.due) !== null) &&
      (l.minimum === null || num(l.minimum) !== null) &&
      (l.statement === null || num(l.statement) !== null) &&
      (l.apr === null || num(l.apr) !== null) &&
      typeof l.overdue === "boolean",
  );
  return ok ? (s as StoredLiabilities) : null;
}

export async function getLiabilities(config: PlaidConfig, accessToken: string, fetchImpl?: typeof fetch): Promise<StoredLiability[]> {
  const res = await plaidRequest<{ liabilities: RawLiabilities }>(config, "/liabilities/get", { access_token: accessToken }, fetchImpl);
  return slimLiabilities(res.liabilities ?? {});
}

/** What an account shows: in cents, positive amounts owed, and a due date only while it's still ahead. */
export function toLiability(l: StoredLiability, today: ISODate): Liability {
  return {
    dueDate: l.due && l.due >= today ? l.due : null,
    minimumPayment: l.minimum === null ? null : toCents(Math.abs(l.minimum)),
    statementBalance: l.statement === null ? null : toCents(Math.abs(l.statement)),
    apr: l.apr,
    overdue: l.overdue,
  };
}
