// One year on one page (year.ts): counted the way the other screens count,
// honest about where the records start and about a year still under way,
// compared with the year before only when Prism holds that whole span.

import { describe, expect, it } from "vitest";
import { sumIncome, sumSpending } from "./cashflow";
import { buildDemoData } from "./demo";
import { monthly, tx } from "./test-helpers";
import type { Account, FinanceData, Transaction } from "./types";
import { defaultYear, reviewYears, yearReview } from "./year";

const checking: Account = { id: "chk", institutionId: "b", name: "Checking", mask: "1234", kind: "checking", balance: 500_000, history: [], source: "plaid" };

function data(today: string, txns: Transaction[], history: number[] = []): FinanceData {
  return {
    source: "plaid",
    today,
    household: { name: "Test", firstName: "Sam" },
    institutions: [{ id: "b", name: "First Bank", health: "healthy", lastSyncedAt: null, source: "plaid" }],
    accounts: [{ ...checking, history: history.length ? history : [checking.balance] }],
    transactions: txns.sort((a, b) => (a.date < b.date ? -1 : 1)),
    budgets: [],
    goals: [],
    holdings: [],
    credit: null,
  };
}

const months = (year: number, upTo = 12) => Array.from({ length: upTo }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

describe("a year that's over", () => {
  const txns = [
    ...monthly([...months(2024), ...months(2025)], 1, 400_000, "Acme Payroll", "income"),
    ...monthly([...months(2024), ...months(2025)], 3, -150_000, "Oak Street Rent", "housing"),
    ...monthly(months(2025), 9, -1_599, "StreamCo", "fun"),
    tx("2025-01-05", 1_200, "Savings interest", "income"),
    tx("2025-07-14", -230_000, "Island Air", "travel"),
    tx("2025-11-20", -8_000, "Corner Grocer", "food"),
    tx("2024-11-20", -6_000, "Corner Grocer", "food"),
  ];
  const r = yearReview(data("2026-03-15", txns), 2025);

  it("counts all of it, the way the other screens do", () => {
    expect(r).toMatchObject({ year: 2025, from: "2025-01-01", to: "2025-12-31", partial: false, recordsFrom: null });
    expect(r.totals.income).toBe(sumIncome(txns, "2025-01-01", "2025-12-31"));
    expect(r.totals.spending).toBe(sumSpending(txns, "2025-01-01", "2025-12-31"));
    expect(r.totals.kept).toBe(r.totals.income - r.totals.spending);
    expect(r.months.map((m) => m.month)).toEqual(months(2025));
  });

  it("compares with the year before, which Prism holds in full", () => {
    expect(r.before).toEqual({
      income: sumIncome(txns, "2024-01-01", "2024-12-31"),
      spending: sumSpending(txns, "2024-01-01", "2024-12-31"),
      kept: sumIncome(txns, "2024-01-01", "2024-12-31") - sumSpending(txns, "2024-01-01", "2024-12-31"),
      savingsRate: expect.any(Number),
    });
    const food = r.categories.find((c) => c.category === "food")!;
    expect(food).toMatchObject({ amount: 8_000, before: 6_000 });
  });

  it("lists where it went largest first, with shares that add up", () => {
    expect(r.categories[0]!.category).toBe("housing");
    expect(r.categories.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 6);
    expect(r.merchants[0]).toMatchObject({ merchant: "Oak Street Rent", amount: 1_800_000, count: 12 });
  });

  it("finds the biggest one-off purchase, and the busiest and quietest months", () => {
    expect(r.biggest).toMatchObject({ merchant: "Island Air", amount: -230_000 });
    // Rent larger than any purchase is still rent: something that repeats is never "the biggest purchase".
    const bigRent = yearReview(data("2026-03-15", [...txns.filter((t) => t.merchant !== "Oak Street Rent"), ...monthly(months(2025), 3, -300_000, "Oak Street Rent", "housing")]), 2025);
    expect(bigRent.biggest?.merchant).toBe("Island Air");
    expect(r.busiest?.month).toBe("2025-07");
    expect(r.quietest?.month).not.toBe("2025-07");
  });

  it("counts pay apart from interest", () => {
    expect(r.pay).toBe(12 * 400_000);
  });

  it("totals what the subscriptions cost over the year", () => {
    expect(r.subscriptions).toMatchObject({ total: 12 * 1_599, count: 1 });
    expect(r.subscriptions.list[0]).toMatchObject({ merchant: "StreamCo", total: 12 * 1_599 });
  });
});

describe("a year still under way", () => {
  const txns = [
    ...monthly([...months(2025), ...months(2026, 3)], 1, 400_000, "Acme Payroll", "income"),
    ...monthly([...months(2025), ...months(2026, 3)], 3, -150_000, "Oak Street Rent", "housing"),
  ];
  const r = yearReview(data("2026-03-15", txns), 2026);

  it("runs to today, says so, and compares with the same span of last year", () => {
    expect(r).toMatchObject({ from: "2026-01-01", to: "2026-03-15", partial: true });
    expect(r.months.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(r.before?.income).toBe(sumIncome(txns, "2025-01-01", "2025-03-15"));
  });

  it("never calls the month in progress the quietest", () => {
    expect(r.quietest?.month).not.toBe("2026-03");
    expect(r.busiest?.month).not.toBe("2026-03");
  });

  it("ends a leap day's span on Feb 28 the year before", () => {
    const leap = yearReview(data("2028-02-29", [...monthly(months(2027), 1, 100_000, "Acme Payroll", "income"), tx("2028-01-02", 100_000, "Acme Payroll", "income")]), 2028);
    expect(leap.to).toBe("2028-02-29");
    expect(leap.before).not.toBeNull();
  });
});

describe("records that start part way through a year", () => {
  const txns = monthly(["2025-04", "2025-05", "2025-06"], 10, -5_000, "Corner Grocer", "food");
  const r = yearReview(data("2025-06-20", txns), 2025);

  it("start the year where they do, and compare with nothing", () => {
    expect(r).toMatchObject({ from: "2025-04-10", recordsFrom: "2025-04-10", before: null });
    expect(r.months.map((m) => m.month)).toEqual(["2025-04", "2025-05", "2025-06"]);
    expect(r.categories[0]).toMatchObject({ category: "food", before: null });
  });

  it("never names a month Prism saw only part of as the quietest", () => {
    // April began before the records did, and June is still under way: May is the only whole month.
    expect(r.busiest?.month).toBe("2025-05");
    expect(r.quietest).toBeNull();
  });
});

describe("net worth across the year", () => {
  it("runs from the end of the month before to the end of the span", () => {
    // Month-end balances Oct 2024 … Mar 2026 (18 months), ending today.
    const history = Array.from({ length: 18 }, (_, i) => 100_000 + i * 10_000);
    const r = yearReview(data("2026-03-15", [tx("2024-12-15", 100, "Acme Payroll", "income")], history), 2025);
    // Dec 2024 is the third point; Dec 2025 the fifteenth.
    expect(r.netWorth).toEqual({ start: 120_000, end: 240_000 });
    // Records that start in February start the year at January's end instead.
    const late = yearReview(data("2026-03-15", [tx("2025-02-01", 100, "Acme Payroll", "income")], history), 2025);
    expect(late.netWorth.start).toBe(130_000);
    // Records that start mid-month start from the end of the month before it, never part way into the span.
    const mid = yearReview(data("2026-03-15", [tx("2025-04-10", 100, "Acme Payroll", "income")], history), 2025);
    expect(mid.netWorth.start).toBe(150_000);
  });

  it("says nothing it can't see", () => {
    const r = yearReview(data("2026-03-15", [tx("2025-02-01", 100, "Acme Payroll", "income")]), 2025);
    expect(r.netWorth.start).toBeNull();
  });
});

describe("which year", () => {
  const txns = [tx("2024-06-01", -100, "A", "food"), tx("2025-06-01", -100, "B", "food"), tx("2026-02-01", -100, "C", "food"), tx("2026-12-01", -100, "Future", "food")];

  it("offers the years Prism has records of, newest first, never one ahead of today", () => {
    expect(reviewYears(data("2026-03-15", txns))).toEqual([2026, 2025, 2024]);
  });

  it("is last year in January and February, this year after", () => {
    expect(defaultYear(data("2026-02-10", txns))).toBe(2025);
    expect(defaultYear(data("2026-03-01", txns))).toBe(2026);
    expect(defaultYear(data("2026-10-01", []))).toBe(2026);
  });

  it("reads the demo household without a gap", () => {
    const demo = buildDemoData("2026-10-01");
    const r = yearReview(demo, defaultYear(demo));
    expect(r.transactions).toBeGreaterThan(50);
    expect(r.totals.income).toBeGreaterThan(0);
  });
});
