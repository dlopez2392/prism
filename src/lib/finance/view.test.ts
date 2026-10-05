import { describe, expect, it } from "vitest";
import { tx } from "./test-helpers";
import { againstLabel, dailyBalances, LEDGER_FIND_MAX, ledgerHash, monthSteps, monthWindow, parseMonth, parseRange, periodLabel, rangeView, readLedgerHash } from "./view";

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

describe("a past month", () => {
  it("is set, whole, against the whole month before it, however long each is", () => {
    expect(monthWindow("2026-09-30", 1)).toMatchObject({ from: "2026-09-01", to: "2026-09-30", prevFrom: "2026-08-01", prevTo: "2026-08-31" });
    // A day-for-day clamp would end January on the 28th.
    expect(monthWindow("2026-02-28", 1)).toMatchObject({ prevFrom: "2026-01-01", prevTo: "2026-01-31" });
    expect(monthWindow("2026-03-31", 1)).toMatchObject({ prevTo: "2026-02-28" });
    expect(monthWindow("2026-02-28", 3)).toMatchObject({ from: "2025-12-01", prevFrom: "2025-09-01", prevTo: "2025-11-30" });
  });

  it("comes from the address only when it's before this month and has something in it", () => {
    const today = "2026-10-05";
    const earliest = "2025-11-14";
    expect(parseMonth("2026-09", today, earliest)).toBe("2026-09");
    expect(parseMonth("2025-11", today, earliest)).toBe("2025-11");
    expect(parseMonth(["2026-08", "2026-07"], today, earliest)).toBe("2026-08");
    for (const raw of [undefined, "", "2026-10", "2026-11", "2025-10", "2026-13", "2026-9", "2026-09-01", "next"]) expect(parseMonth(raw, today, earliest)).toBeNull();
    // With nothing in it at all, there's no past month to show.
    expect(parseMonth("2026-09", today, null)).toBeNull();
  });

  it("steps back as far as the oldest transaction, and forward to this month", () => {
    const today = "2026-10-05";
    expect(monthSteps(null, today, "2025-11-14")).toEqual({ older: "2026-09", newer: null });
    expect(monthSteps("2026-09", today, "2025-11-14")).toEqual({ older: "2026-08", newer: "current" });
    expect(monthSteps("2026-01", today, "2025-11-14")).toEqual({ older: "2025-12", newer: "2026-02" });
    expect(monthSteps("2025-11", today, "2025-11-14")).toEqual({ older: null, newer: "2025-12" });
    expect(monthSteps(null, today, "2026-10-02")).toEqual({ older: null, newer: null });
    expect(monthSteps(null, today, null)).toEqual({ older: null, newer: null });
  });

  it("is named whole by its month, and part of one by its days", () => {
    expect(againstLabel("2026-08-01", "2026-08-31")).toBe("August");
    expect(againstLabel("2026-02-01", "2026-02-28")).toBe("February");
    expect(againstLabel("2026-09-01", "2026-09-05")).toBe("Sep 1 – 5");
  });

  it("is what an address asks for, and only with one month chosen", () => {
    const txns = [tx("2025-11-14", -500, "a", "food", "chk"), tx("2026-10-02", -900, "b", "food", "chk")];
    expect(rangeView({ range: "1", month: "2026-09" }, "2026-10-05", txns)).toMatchObject({
      range: 1,
      month: "2026-09",
      w: { from: "2026-09-01", to: "2026-09-30", prevFrom: "2026-08-01", prevTo: "2026-08-31", trend: ["2026-08", "2026-09"] },
      step: { shown: "2026-09", older: "2026-08", newer: "current" },
    });
    expect(rangeView({ range: "1" }, "2026-10-05", txns)).toMatchObject({ month: null, w: { from: "2026-10-01", to: "2026-10-05" }, step: { shown: "2026-10", older: "2026-09", newer: null } });
    // A month named beside a longer range is ignored: the range always ends today.
    expect(rangeView({ range: "3", month: "2026-09" }, "2026-10-05", txns)).toMatchObject({ range: 3, month: null, w: { to: "2026-10-05" }, step: undefined });
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
