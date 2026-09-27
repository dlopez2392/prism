import { describe, expect, it } from "vitest";
import {
  categoryBreakdown,
  cumulativeSpend,
  incomeSources,
  monthlyCashFlow,
  monthToDate,
  topMerchants,
} from "./cashflow";
import { tx } from "./test-helpers";

describe("monthlyCashFlow", () => {
  const txns = [
    tx("2026-08-01", 500_000, "Acme payroll", "income"),
    tx("2026-08-02", -195_000, "Rent", "housing"),
    tx("2026-08-03", -8_000, "Dinner", "food", "card"),
    tx("2026-08-04", 2_000, "Dinner refund", "food", "card"),
    // Moving money between your own accounts is not spending, twice over.
    tx("2026-08-18", -150_000, "Card payment", "transfer"),
    tx("2026-08-18", 150_000, "Payment received", "transfer", "card"),
    tx("2026-08-20", -60_000, "To savings", "transfer"),
  ];

  it("counts income and spending, never transfers", () => {
    const [aug] = monthlyCashFlow(txns, ["2026-08"]);
    expect(aug).toEqual({
      month: "2026-08",
      income: 500_000,
      spending: 201_000,
      net: 299_000,
      savingsRate: 299_000 / 500_000,
    });
  });

  it("reports no savings rate for a month without income", () => {
    const [jul] = monthlyCashFlow(txns, ["2026-07"]);
    expect(jul!.savingsRate).toBeNull();
  });
});

describe("categoryBreakdown", () => {
  it("compares against the previous period and drops empty rows", () => {
    const rows = categoryBreakdown(
      [
        tx("2026-09-02", -30_000, "Groceries", "food"),
        tx("2026-08-02", -20_000, "Groceries", "food"),
        tx("2026-09-03", -10_000, "Gas", "transport"),
      ],
      { from: "2026-09-01", to: "2026-09-30" },
      { from: "2026-08-01", to: "2026-08-31" },
    );
    expect(rows.map((r) => r.category)).toEqual(["food", "transport"]);
    expect(rows[0]!.change).toBeCloseTo(0.5);
    expect(rows[0]!.share).toBeCloseTo(0.75);
    expect(rows[1]!.change).toBeNull();
  });
});

describe("cumulativeSpend", () => {
  it("accumulates by day and stops at `through`", () => {
    const curve = cumulativeSpend(
      [tx("2026-09-01", -1_000, "a", "food"), tx("2026-09-03", -500, "b", "fun"), tx("2026-09-03", 9_999, "pay", "income")],
      "2026-09-01",
      "2026-09-04",
    );
    expect(curve).toEqual([1_000, 1_000, 1_500, 1_500]);
  });
});

describe("incomeSources", () => {
  it("names paychecks plainly and folds the tail into Other income", () => {
    const sources = incomeSources(
      [
        tx("2026-09-05", 300_000, "Lumen Design Co. payroll", "income"),
        tx("2026-09-19", 300_000, "Lumen Design Co. payroll", "income"),
        tx("2026-09-10", 40_000, "Studio Kiln — client payment", "income"),
        tx("2026-09-30", 6_000, "Interest earned", "income"),
        tx("2026-09-12", 2_500, "Cashback", "income"),
      ],
      "2026-09-01",
      "2026-09-30",
      3,
    );
    expect(sources).toEqual([
      { name: "Paycheck", amount: 600_000 },
      { name: "Side work", amount: 40_000 },
      { name: "Other income", amount: 8_500 },
    ]);
  });
});

describe("topMerchants", () => {
  it("ranks merchants by spend", () => {
    const rows = topMerchants(
      [tx("2026-09-01", -500, "Café", "food"), tx("2026-09-02", -500, "Café", "food"), tx("2026-09-03", -800, "Books", "shopping")],
      "2026-09-01",
      "2026-09-30",
    );
    expect(rows[0]).toMatchObject({ merchant: "Café", amount: 1_000, count: 2 });
  });
});

describe("monthToDate", () => {
  it("clamps the comparison span to a shorter previous month", () => {
    expect(monthToDate("2026-03-31")).toMatchObject({
      from: "2026-03-01",
      prevFrom: "2026-02-01",
      prevTo: "2026-02-28",
      prevMonthEnd: "2026-02-28",
    });
  });
});

describe("foldSlices", () => {
  it("keeps six named categories and folds the rest, Other included", async () => {
    const { foldSlices } = await import("./view");
    const rows = (["housing", "food", "transport", "shopping", "fun", "health", "travel", "other"] as const).map((category, i) => ({
      category,
      amount: 1_000 - i * 100,
      share: 0,
      previous: 0,
      change: null,
    }));
    const slices = foldSlices(rows);
    expect(slices.map((s) => s.id)).toEqual(["housing", "food", "transport", "shopping", "fun", "health", "rest"]);
    expect(slices.at(-1)!.value).toBe(400 + 300);
  });
});
