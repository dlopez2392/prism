// Estimated tax (estimated-tax.ts): the four due dates, moved off weekends and
// holidays; who it's for; each quarter's target from last year's return; and
// the payments to the IRS Prism sees, last year's bill left out.

import { describe, expect, it } from "vitest";
import { dueDates, estimatedTax, paymentYear, taxDues, validTaxDue } from "./estimated-tax";
import type { TaxReturn } from "./tax-return";
import { tx } from "./test-helpers";
import type { Account } from "./types";

const account = (id: string): Account => ({ id, institutionId: "bank", name: id, mask: null, kind: "checking", balance: 0, history: [] }) as unknown as Account;

const lastYear = (extra: Partial<TaxReturn> = {}): TaxReturn => ({
  year: 2025,
  status: "single",
  wages: 6_000_000,
  business: 3_000_000,
  totalIncome: 9_000_000,
  agi: 8_800_000,
  taxable: 7_300_000,
  totalTax: 1_200_000,
  withheld: 800_000,
  estimated: 300_000,
  payments: 1_100_000,
  refund: null,
  owed: 100_000,
  ...extra,
});

describe("due dates", () => {
  it("are the 15th of April, June, September and the next January, moved past weekends and holidays", () => {
    expect(dueDates(2026).map((q) => q.due)).toEqual(["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]);
    // 2022: April 15 was Emancipation Day observed (the 16th was a Saturday), so the 18th.
    expect(dueDates(2022)[0]!.due).toBe("2022-04-18");
    // 2028: January 15, 2029 is Martin Luther King Jr. Day, so the 16th.
    expect(dueDates(2028)[3]!.due).toBe("2029-01-16");
    // 2025: June 15 is a Sunday.
    expect(dueDates(2025)[1]!.due).toBe("2025-06-16");
  });

  it("are last year's until its January payment is due", () => {
    expect(paymentYear("2027-01-15")).toBe(2026);
    expect(paymentYear("2027-01-16")).toBe(2027);
    expect(paymentYear("2026-10-22")).toBe(2026);
  });
});

describe("estimated tax", () => {
  const today = "2026-10-22";
  const base = { today, accounts: [account("chk")], hiddenAccounts: [], businessAccountIds: [] as string[] };

  it("is nothing for someone with no business and no estimated tax last year", () => {
    expect(estimatedTax({ ...base, transactions: [], taxReturns: [lastYear({ estimated: null, owed: null, refund: 50_000 })] })).toBeNull();
    expect(estimatedTax({ ...base, transactions: [] })).toBeNull();
  });

  it("sets each quarter's target from last year's safe harbor less its withholding, and counts what reached the IRS", () => {
    const txns = [
      // Last year's balance due, paid by April 15: not this year's estimate.
      tx("2026-04-14", -100_000, "IRS USATAXPYMT", "bills"),
      tx("2026-04-14", -100_000, "IRS USATAXPYMT", "bills"),
      tx("2026-06-12", -100_000, "IRS USATAXPYMT", "bills"),
      // Last year's January payment, and a state payment: neither counts.
      tx("2026-01-14", -75_000, "IRS USATAXPYMT", "bills"),
      tx("2026-09-10", -40_000, "State Dept of Revenue", "bills"),
    ];
    const e = estimatedTax({ ...base, transactions: txns, taxReturns: [lastYear()] })!;
    expect(e).toMatchObject({ taxYear: 2026, why: "estimated", withheldLastYear: 800_000, safeHarbor: { amount: 1_200_000, share: 1, lastYear: 2025 } });
    // ($12,000 − $8,000) ÷ 4.
    expect(e.perQuarter).toBe(100_000);
    expect(e.lastYearsBill?.date).toBe("2026-04-14");
    expect(e.paidTotal).toBe(200_000);
    expect(e.quarters.map((q) => [q.n, q.target, q.paid, q.state])).toEqual([
      [1, 100_000, 100_000, "paid"],
      [2, 200_000, 200_000, "paid"],
      [3, 300_000, 200_000, "short"],
      [4, 400_000, 200_000, "upcoming"],
    ]);
    expect(e.next?.n).toBe(4);
  });

  it("uses 110% over $150,000 AGI, and says so when withholding alone covered it", () => {
    const high = estimatedTax({ ...base, transactions: [], taxReturns: [lastYear({ agi: 20_000_000, totalTax: 4_000_000, withheld: 1_000_000 })] })!;
    expect(high.safeHarbor).toMatchObject({ amount: 4_400_000, share: 1.1 });
    expect(high.perQuarter).toBe(850_000);
    const covered = estimatedTax({ ...base, transactions: [], taxReturns: [lastYear({ withheld: 1_500_000 })] })!;
    expect(covered.perQuarter).toBe(0);
    expect(covered.quarters.every((q) => q.state === "paid" || q.due < today)).toBe(true);
  });

  it("is for a business that made money this year, with dates but no target until last year's return is added", () => {
    const txns = [tx("2026-03-01", 900_000, "Client invoice", "income", "biz"), tx("2026-03-09", -100_000, "Supplier", "shopping", "biz")];
    const e = estimatedTax({ ...base, transactions: txns, hiddenAccounts: [account("biz")], businessAccountIds: ["biz"] })!;
    expect(e).toMatchObject({ why: "business", businessNet: 800_000, perQuarter: null, safeHarbor: null });
    expect(e.quarters.map((q) => [q.target, q.state])).toEqual([
      [null, "short"],
      [null, "short"],
      [null, "short"],
      [null, "upcoming"],
    ]);
  });

  it("gives the calendar only the dates still to come, and nothing a stored copy can't vouch for", () => {
    const dues = taxDues({ ...base, transactions: [], taxReturns: [lastYear()] });
    expect(dues).toEqual([{ due: "2027-01-15", quarter: 4, taxYear: 2026, amount: 100_000 }]);
    expect(dues.every(validTaxDue)).toBe(true);
    expect(validTaxDue({ due: "2027-01-15", quarter: 5, taxYear: 2026, amount: null })).toBe(false);
    expect(validTaxDue({ due: "Jan 15", quarter: 4, taxYear: 2026, amount: null })).toBe(false);
  });
});
