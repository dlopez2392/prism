import { describe, expect, it } from "vitest";
import { budgetStatuses, budgetTotals, daysLeftInMonth, typicalMonthlySpend } from "./budgets";
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
