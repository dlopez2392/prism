import { describe, expect, it } from "vitest";
import { budgetStatuses, budgetTotals, daysLeftInMonth, draftBudgets, typicalMonthlySpend } from "./budgets";
import { monthly, tx } from "./test-helpers";

const history = ["2026-06", "2026-07", "2026-08"];

describe("budgetStatuses", () => {
  it("does not project rent thirty times over on the 2nd of the month", () => {
    const txns = [
      ...monthly([...history, "2026-09"], 1, -195_000, "Rent", "housing"),
    ];
    const [housing] = budgetStatuses([{ category: "housing", limit: 200_000 }], txns, "2026-09-02");
    expect(housing).toMatchObject({ spent: 195_000, projected: 195_000, state: "on_track" });
  });

  it("projects day-to-day spending from what usually lands later in the month", () => {
    const txns = [
      ...monthly(history, 5, -10_000, "Groceries", "food"),
      ...monthly(history, 25, -30_000, "Groceries", "food"),
      tx("2026-09-05", -10_000, "Groceries", "food"),
    ];
    const [food] = budgetStatuses([{ category: "food", limit: 35_000 }], txns, "2026-09-10");
    expect(food!.projected).toBe(40_000);
    expect(food!.state).toBe("at_risk");
    expect(food!.timeElapsed).toBeCloseTo(10 / 30);
  });

  it("marks a budget over once spending passes the limit", () => {
    const [fun] = budgetStatuses([{ category: "fun", limit: 5_000 }], [tx("2026-09-03", -6_000, "Show", "fun")], "2026-09-04");
    expect(fun).toMatchObject({ state: "over", remaining: -1_000 });
  });

  it("totals limits, spending and projections", () => {
    const statuses = budgetStatuses(
      [
        { category: "fun", limit: 5_000 },
        { category: "food", limit: 10_000 },
      ],
      [tx("2026-09-03", -6_000, "Show", "fun")],
      "2026-09-04",
    );
    expect(budgetTotals(statuses)).toMatchObject({ limit: 15_000, spent: 6_000, remaining: 9_000 });
  });
});

describe("daysLeftInMonth", () => {
  it("counts today", () => {
    expect(daysLeftInMonth("2026-09-30")).toBe(1);
    expect(daysLeftInMonth("2026-02-01")).toBe(28);
  });
});

describe("typicalMonthlySpend", () => {
  it("averages the last three FULL months and ignores the current one", () => {
    const txns = [
      ...monthly(history, 1, -195_000, "Rent", "housing"),
      ...monthly(history, 10, [-30_000, -45_000, -60_000], "Groceries", "food"),
      tx("2026-09-02", -999_999, "This month", "food"),
      tx("2026-08-03", 500_000, "Paycheck", "income"),
    ];
    const typical = typicalMonthlySpend(txns, "2026-09-15");
    expect(typical.housing).toBe(195_000);
    expect(typical.food).toBe(45_000);
    expect(typical.travel).toBe(0);
    expect(Object.keys(typical)).toHaveLength(9);
  });
});

describe("draftBudgets", () => {
  it("drafts one line per category that saw spending in the last three FULL months, rounded up to $25", () => {
    const txns = [
      tx("2026-06-30", -999_00, "Too old", "food"),
      tx("2026-07-05", -100_00, "Grocer", "food"),
      tx("2026-08-05", -110_00, "Grocer", "food"),
      tx("2026-09-05", -120_00, "Grocer", "food"),
      tx("2026-09-12", -5_00, "Bus", "transport"),
      tx("2026-09-30", -400_00, "This month", "shopping"),
      tx("2026-08-01", 2_000_00, "Payroll", "income"),
    ];
    expect(draftBudgets(txns, "2026-10-01")).toEqual([
      { category: "food", limit: 125_00 },
      { category: "transport", limit: 25_00 },
      { category: "shopping", limit: 150_00 },
    ]);
    expect(draftBudgets(txns, "2026-09-15").map((b) => b.category)).toEqual(["food"]);
    expect(draftBudgets([], "2026-10-01")).toEqual([]);
  });
});
