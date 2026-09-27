import { describe, expect, it } from "vitest";
import { tx } from "./test-helpers";
import { dailyBalances, monthWindow, parseRange } from "./view";

describe("monthWindow", () => {
  it("counts the current month and mirrors the span before it", () => {
    expect(monthWindow("2026-09-27", 3)).toMatchObject({
      from: "2026-07-01",
      to: "2026-09-27",
      prevTo: "2026-06-30",
      months: ["2026-07", "2026-08", "2026-09"],
    });
  });
});

describe("parseRange", () => {
  it("accepts only the offered ranges", () => {
    expect(parseRange("12")).toBe(12);
    expect(parseRange("7")).toBe(6);
    expect(parseRange(undefined, 3)).toBe(3);
  });
});

describe("dailyBalances", () => {
  it("walks backwards from today's balance", () => {
    const out = dailyBalances(
      [tx("2026-09-02", -500, "a", "food", "chk"), tx("2026-09-03", 1_000, "pay", "income", "chk"), tx("2026-09-03", -99, "x", "food", "card")],
      "chk",
      10_000,
      "2026-09-01",
      "2026-09-03",
    );
    expect(out).toEqual([
      { date: "2026-09-01", balance: 9_500 },
      { date: "2026-09-02", balance: 9_000 },
      { date: "2026-09-03", balance: 10_000 },
    ]);
  });
});
