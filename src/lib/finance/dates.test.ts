import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysBetween, eachDay, lastMonths } from "./dates";
import { money, money0, moneyCompact, shortDate, signedMoney0 } from "./format";

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
  });
});
