// A card's or a loan's terms, from Plaid Liabilities down to what Prism keeps
// and shows (liabilities.ts): only the fields shown, a card's PURCHASE APR, a
// mortgage's monthly payment as its minimum, and a due date only while ahead.

import { describe, expect, it } from "vitest";
import { holdsDebt, liabilitiesEnabled, liabilitiesStale, LIABILITIES_FRESH_MS, slimLiabilities, toLiability, validLiabilities, type StoredLiability } from "./liabilities";
import { validState } from "./sync";
import type { PlaidAccount } from "./client";

const card: StoredLiability = { account_id: "card", due: "2026-10-14", minimum: 35, statement: 1240.5, apr: 24.99, overdue: false };

describe("what Plaid says a card or a loan asks for", () => {
  it("is kept down to the due date, minimum, statement balance, rate and whether it's overdue", () => {
    const slim = slimLiabilities({
      credit: [
        {
          account_id: "card",
          aprs: [
            { apr_percentage: 29.99, apr_type: "cash_apr" },
            { apr_percentage: 24.99, apr_type: "purchase_apr" },
          ],
          is_overdue: false,
          last_statement_balance: 1240.5,
          minimum_payment_amount: 35,
          next_payment_due_date: "2026-10-14",
          // Anything else Plaid sends is left behind.
          ...({ last_payment_amount: 200, last_payment_date: "2026-09-12" } as object),
        },
      ],
      mortgage: [{ account_id: "home", next_payment_due_date: "2026-11-01", next_monthly_payment: 2100.12, interest_rate: { percentage: 6.25 }, past_due_amount: 2100.12 }],
      student: [{ account_id: "school", minimum_payment_amount: 212, next_payment_due_date: "2026-10-23", interest_rate_percentage: 5.05, is_overdue: null, last_statement_balance: 14720 }],
    });
    expect(slim).toEqual([
      card,
      { account_id: "home", due: "2026-11-01", minimum: 2100.12, statement: null, apr: 6.25, overdue: true },
      { account_id: "school", due: "2026-10-23", minimum: 212, statement: 14720, apr: 5.05, overdue: false },
    ]);
  });

  it("takes the first rate listed when a card has no purchase APR, and nothing it can't read", () => {
    const [c] = slimLiabilities({ credit: [{ account_id: "c", aprs: [{ apr_percentage: 19.5, apr_type: "special" }], next_payment_due_date: "Oct 14", minimum_payment_amount: Number.NaN }] });
    expect(c).toEqual({ account_id: "c", due: null, minimum: null, statement: null, apr: 19.5, overdue: false });
    // A student loan Plaid can't tie to an account can't be shown against one.
    expect(slimLiabilities({ student: [{ account_id: null, interest_rate_percentage: 5 }] })).toEqual([]);
    expect(slimLiabilities({})).toEqual([]);
  });

  it("shows owed amounts as positive cents, and a due date only while it's still ahead", () => {
    expect(toLiability(card, "2026-10-14")).toEqual({ dueDate: "2026-10-14", minimumPayment: 3_500, statementBalance: 124_050, apr: 24.99, overdue: false });
    expect(toLiability(card, "2026-10-15").dueDate).toBeNull();
    // A lender reporting a credit balance as negative still owes nothing negative.
    expect(toLiability({ ...card, statement: -12, minimum: null }, "2026-10-01")).toMatchObject({ statementBalance: 1_200, minimumPayment: null });
  });
});

describe("reading Liabilities", () => {
  it("is off unless the operator switches it on exactly", () => {
    expect(liabilitiesEnabled({})).toBe(false);
    for (const v of ["", "1", "true", "ON", "yes"]) expect(liabilitiesEnabled({ PLAID_LIABILITIES: v }), v).toBe(false);
    expect(liabilitiesEnabled({ PLAID_LIABILITIES: "on" })).toBe(true);
    expect(liabilitiesEnabled({ PLAID_LIABILITIES: " on " })).toBe(true);
  });

  it("is only for a bank that holds a card or a loan", () => {
    const acc = (type: PlaidAccount["type"]) => ({ account_id: type, name: type, official_name: null, mask: null, type, subtype: null, balances: { available: 0, current: 0, iso_currency_code: "USD" } });
    expect(holdsDebt([acc("depository"), acc("investment")])).toBe(false);
    expect(holdsDebt([acc("depository"), acc("credit")])).toBe(true);
    expect(holdsDebt([acc("loan")])).toBe(true);
  });

  it("happens at most once a day", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    expect(liabilitiesStale(null, now)).toBe(true);
    expect(liabilitiesStale({ at: new Date(now - LIABILITIES_FRESH_MS + 60_000).toISOString(), list: [] }, now)).toBe(false);
    expect(liabilitiesStale({ at: new Date(now - LIABILITIES_FRESH_MS - 60_000).toISOString(), list: [] }, now)).toBe(true);
    expect(liabilitiesStale({ at: "not a date", list: [] }, now)).toBe(true);
  });
});

describe("the kept copy", () => {
  it("keeps terms that check out, and drops ones that don't without costing the bank its copy", () => {
    const kept = { at: "2026-09-30T12:00:00Z", list: [card] };
    expect(validLiabilities(kept)).toEqual(kept);
    for (const bad of [null, {}, { at: 1, list: [] }, { at: "x", list: [{ ...card, due: "soon" }] }, { at: "x", list: [{ ...card, overdue: "no" }] }, { at: "x", list: [{ ...card, apr: "24%" }] }]) {
      expect(validLiabilities(bad)).toBeNull();
    }
    const state = { v: 1 as const, cursor: "c", transactions: [], ready: true, accounts: [] };
    expect(validState({ ...state, liabilities: kept })).toEqual({ ...state, liabilities: kept });
    expect(validState({ ...state, liabilities: { at: 5 } })).toEqual({ ...state, liabilities: null });
    // A copy from before terms were kept reads exactly as it was.
    expect(validState(state)).toEqual(state);
  });
});
