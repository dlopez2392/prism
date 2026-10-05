import { describe, expect, it } from "vitest";
import { addDays, addMonths, bankHolidays, daysBetween, eachDay, isBusinessDay, lastMonths, nthWeekdayOfMonth, previousBusinessDay } from "./dates";
import { dayRange, money, money0, moneyCompact, shortDate, signedMoney0 } from "./format";

describe("calendar arithmetic", () => {
  it("clamps month-end when adding months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });

  it("counts calendar days across a DST change", () => {
    // US clocks spring forward on 2026-03-08; a calendar day is still a day.
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
  });

  it("lists the trailing months oldest first", () => {
    expect(lastMonths("2026-02-10", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("walks every day inclusive", () => {
    expect(eachDay("2026-02-27", "2026-03-01")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
  });
});

describe("the days banks are open", () => {
  it("finds the nth and the last weekday of a month", () => {
    expect(nthWeekdayOfMonth(2026, 11, 4, 4)).toBe("2026-11-26"); // Thanksgiving
    expect(nthWeekdayOfMonth(2026, 5, 1, -1)).toBe("2026-05-25"); // Memorial Day
    expect(nthWeekdayOfMonth(2026, 9, 1, 1)).toBe("2026-09-07"); // Labor Day
  });

  it("knows the Federal Reserve's holidays, a Sunday one moved to Monday and a Saturday one closing nothing", () => {
    expect([...bankHolidays(2026)].sort()).toEqual([
      "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-04",
      "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25",
    ]);
    // July 4, 2026 is a Saturday: banks open the Friday before as usual.
    expect(isBusinessDay("2026-07-03")).toBe(true);
    expect(isBusinessDay("2026-07-04")).toBe(false);
    // June 19, 2022 was a Sunday: observed Monday the 20th.
    expect(bankHolidays(2022).has("2022-06-20")).toBe(true);
  });

  it("moves a payday back to the last business day on or before it", () => {
    expect(previousBusinessDay("2026-10-15")).toBe("2026-10-15"); // a Thursday
    expect(previousBusinessDay("2026-10-31")).toBe("2026-10-30"); // Saturday → Friday
    expect(previousBusinessDay("2026-12-25")).toBe("2026-12-24"); // Christmas, a Friday → Thursday
    expect(previousBusinessDay("2026-09-07")).toBe("2026-09-04"); // Labor Day Monday → Friday
  });
});

describe("money formatting", () => {
  it("formats integer cents", () => {
    expect(money(123456)).toBe("$1,234.56");
    expect(money0(123456)).toBe("$1,235");
    expect(money(-500)).toBe("-$5.00");
  });

  it("compacts axis values", () => {
    expect(moneyCompact(95_000)).toBe("$950");
    expect(moneyCompact(125_000)).toBe("$1.3K");
    expect(moneyCompact(4_800_000)).toBe("$48K");
    expect(moneyCompact(130_000_000)).toBe("$1.3M");
    expect(moneyCompact(-250_000)).toBe("-$2.5K");
  });

  it("signs deltas with a true minus", () => {
    expect(signedMoney0(12_000)).toBe("+$120");
    expect(signedMoney0(-4_500)).toBe("−$45");
  });

  it("formats dates without touching the viewer's zone", () => {
    expect(shortDate("2026-09-01")).toBe("Sep 1");
    expect(dayRange("2026-09-01", "2026-09-05")).toBe("Sep 1 – 5");
    expect(dayRange("2026-09-28", "2026-10-03")).toBe("Sep 28 – Oct 3");
    expect(dayRange("2026-09-01", "2026-09-01")).toBe("Sep 1");
  });
});
