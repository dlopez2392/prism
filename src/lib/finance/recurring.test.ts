import { describe, expect, it } from "vitest";
import { detectRecurring, monthlyCost, occurrences } from "./recurring";
import { monthly, tx } from "./test-helpers";

const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

describe("detectRecurring", () => {
  it("finds a fixed monthly subscription and when it charges next", () => {
    const [s] = detectRecurring(monthly(months, 3, -1_199, "Tunely Music", "fun", "card"), "2026-09-20");
    expect(s).toMatchObject({
      merchant: "Tunely Music",
      cadence: "monthly",
      kind: "subscription",
      variable: false,
      amount: -1_199,
      nextDate: "2026-10-03",
    });
  });

  it("finds a biweekly paycheck", () => {
    const pays = Array.from({ length: 8 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 5, 5 + 14 * i)).toISOString().slice(0, 10);
      return tx(d, 286_418, "Acme payroll", "income");
    });
    const [s] = detectRecurring(pays, "2026-09-20");
    expect(s).toMatchObject({ kind: "income", cadence: "biweekly", nextDate: "2026-09-25" });
  });

  it("reports a price rise on a fixed charge instead of calling it variable", () => {
    const [s] = detectRecurring(
      monthly(months, 22, [-1_549, -1_549, -1_549, -1_549, -1_799, -1_799], "Streamflix", "fun", "card"),
      "2026-09-25",
    );
    expect(s!.variable).toBe(false);
    expect(s!.priceChange).toEqual({ from: -1_549, to: -1_799, date: "2026-08-22" });
  });

  it("treats a utility whose amount moves as a variable bill", () => {
    const [s] = detectRecurring(
      monthly(months, 12, [-8_100, -9_400, -13_900, -14_200, -12_000, -7_900], "Bright Power", "bills"),
      "2026-09-20",
    );
    expect(s).toMatchObject({ kind: "bill", variable: true, priceChange: null });
  });

  it("drops a stream that stopped charging", () => {
    expect(detectRecurring(monthly(["2026-03", "2026-04", "2026-05"], 3, -999, "Old app", "fun"), "2026-09-20")).toEqual([]);
  });

  it("ignores irregular spending", () => {
    const coffee = ["2026-09-01", "2026-09-02", "2026-09-05", "2026-09-06", "2026-09-15", "2026-09-16"].map((d) =>
      tx(d, -550, "Café", "food"),
    );
    expect(detectRecurring(coffee, "2026-09-20")).toEqual([]);
  });
});

describe("occurrences", () => {
  it("counts months from the last real charge so month-end never drifts", () => {
    const [s] = detectRecurring(monthly(["2025-11", "2025-12", "2026-01"], 31, -5_000, "Storage", "bills"), "2026-02-01");
    expect(occurrences(s!, "2026-02-01", "2026-04-30")).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("annualises by cadence", () => {
    const [s] = detectRecurring(monthly(months, 3, -1_000, "App", "fun"), "2026-09-20");
    expect(monthlyCost(s!)).toBe(1_000);
  });
});
