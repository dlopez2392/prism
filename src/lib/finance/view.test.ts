import { describe, expect, it } from "vitest";
import { tx } from "./test-helpers";
import { dailyBalances, LEDGER_FIND_MAX, ledgerHash, monthWindow, parseRange, periodLabel, readLedgerHash } from "./view";

describe("monthWindow", () => {
  it("counts the current month and sets it against the same days, as many months before", () => {
    expect(monthWindow("2026-09-27", 3)).toEqual({
      from: "2026-07-01",
      to: "2026-09-27",
      prevFrom: "2026-04-01",
      prevTo: "2026-06-27",
      months: ["2026-07", "2026-08", "2026-09"],
      trend: ["2026-07", "2026-08", "2026-09"],
    });
  });

  it("holds as many month starts as the window it's compared with, so rent and paydays are never counted short", () => {
    // Early in a month, a window of equal LENGTH before Aug 1 would start on May 27 and hold only two firsts.
    const w = monthWindow("2026-10-05", 3);
    expect([w.from, w.to, w.prevFrom, w.prevTo]).toEqual(["2026-08-01", "2026-10-05", "2026-05-01", "2026-07-05"]);
  });

  it("sets one month so far against the same days of the last one", () => {
    expect(monthWindow("2026-10-05", 1)).toMatchObject({ from: "2026-10-01", to: "2026-10-05", prevFrom: "2026-09-01", prevTo: "2026-09-05", months: ["2026-10"] });
    // The first of the month is one day against one day.
    expect(monthWindow("2026-10-01", 1)).toMatchObject({ from: "2026-10-01", prevFrom: "2026-09-01", prevTo: "2026-09-01" });
  });

  it("clamps to a shorter month, and reaches back across the new year", () => {
    expect(monthWindow("2026-03-31", 1)).toMatchObject({ prevFrom: "2026-02-01", prevTo: "2026-02-28" });
    expect(monthWindow("2028-03-31", 1)).toMatchObject({ prevTo: "2028-02-29" });
    expect(monthWindow("2027-01-12", 1)).toMatchObject({ prevFrom: "2026-12-01", prevTo: "2026-12-12" });
    expect(monthWindow("2027-01-12", 12)).toMatchObject({ from: "2026-02-01", prevFrom: "2025-02-01", prevTo: "2026-01-12" });
  });

  it("draws a one-month window's trend charts with the month it's compared with beside it", () => {
    expect(monthWindow("2026-10-05", 1).trend).toEqual(["2026-09", "2026-10"]);
    expect(monthWindow("2026-10-05", 6).trend).toEqual(monthWindow("2026-10-05", 6).months);
  });
});

describe("periodLabel", () => {
  it("names a window by its months, once when it's one", () => {
    expect(periodLabel("2026-08-01", "2026-10-05")).toBe("Aug 2026 – Oct 2026");
    expect(periodLabel("2026-10-01", "2026-10-05")).toBe("Oct 2026");
  });
});

describe("parseRange", () => {
  it("accepts only the offered ranges", () => {
    expect(parseRange("1")).toBe(1);
    expect(parseRange("12")).toBe(12);
    expect(parseRange("7")).toBe(6);
    expect(parseRange("0")).toBe(6);
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

describe("ledger links", () => {
  it("carry a category or a merchant in the fragment, and read back as they were written", () => {
    expect(ledgerHash({ category: "food" })).toBe("#category=food");
    expect(ledgerHash({ find: "green basket & co" })).toBe("#find=green+basket+%26+co");
    expect(readLedgerHash(ledgerHash({ find: "green basket & co" }))).toEqual({ find: "green basket & co" });
    expect(readLedgerHash(ledgerHash({ category: "transfer" }))).toEqual({ category: "transfer" });
  });

  it("ignore a fragment that asks for nothing a ledger knows", () => {
    for (const hash of ["", "#", "#transactions", "#category=snacks", "#category=__proto__", "#category=toString", "#find=", "#find=%20%20"]) expect(readLedgerHash(hash)).toBeNull();
  });

  it("never ask for more than the search box takes", () => {
    expect(readLedgerHash(`#find=${"a".repeat(500)}`)).toEqual({ find: "a".repeat(LEDGER_FIND_MAX) });
    expect(ledgerHash({ find: "b".repeat(500) })).toBe(`#find=${"b".repeat(LEDGER_FIND_MAX)}`);
  });
});
