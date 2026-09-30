import { describe, expect, it } from "vitest";
import { detectRecurring, monthlyCost, occurrences, type RecurringStream } from "./recurring";
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

describe("pay that follows a rule", () => {
  const paid = (dates: string[], merchant = "Acme payroll", account = "chk") => dates.map((d) => tx(d, 250_000, merchant, "income", account));
  const only = (dates: string[], today: string, merchant?: string, account?: string): RecurringStream => {
    const found = detectRecurring(paid(dates, merchant, account), today);
    expect(found).toHaveLength(1);
    return found[0]!;
  };

  it("knows the 15th and the last day of the month, moved to the Friday before a weekend, instead of calling it every two weeks", () => {
    const s = only(
      // May 31 and Aug 15 fell on a weekend: paid the Friday before.
      ["2026-04-15", "2026-04-30", "2026-05-15", "2026-05-29", "2026-06-15", "2026-06-30", "2026-07-15", "2026-07-31", "2026-08-14", "2026-08-31", "2026-09-15", "2026-09-30"],
      "2026-10-05",
    );
    expect(s).toMatchObject({ cadence: "semimonthly", schedule: { kind: "monthDays", days: [15, 31] }, nextDate: "2026-10-15" });
    // Oct 31 is a Saturday and Nov 15 a Sunday. Every two weeks would have said Oct 14, Oct 28, Nov 11…
    expect(occurrences(s, "2026-10-06", "2026-12-31")).toEqual(["2026-10-15", "2026-10-30", "2026-11-13", "2026-11-30", "2026-12-15", "2026-12-31"]);
    expect(monthlyCost(s)).toBe(500_000);
  });

  it("knows the 1st and the 15th, even when the 1st moves back into the month before", () => {
    const s = only(["2026-06-01", "2026-06-15", "2026-07-01", "2026-07-15", "2026-07-31", "2026-08-14", "2026-09-01", "2026-09-15"], "2026-09-20");
    expect(s).toMatchObject({ cadence: "semimonthly", schedule: { kind: "monthDays", days: [1, 15] }, nextDate: "2026-10-01" });
    // Nov 1 is a Sunday (paid Fri Oct 30) and Nov 15 a Sunday (paid Fri Nov 13).
    expect(occurrences(s, "2026-09-21", "2026-11-20")).toEqual(["2026-10-01", "2026-10-15", "2026-10-30", "2026-11-13"]);
  });

  it("keeps every other Friday as it is, and pays the day before a Friday bank holiday", () => {
    // Juneteenth (Friday, Jun 19) was paid on the Thursday before.
    const s = only(["2026-06-05", "2026-06-18", "2026-07-03", "2026-07-17", "2026-07-31", "2026-08-14", "2026-08-28", "2026-09-11", "2026-09-25"], "2026-09-30");
    expect(s).toMatchObject({ cadence: "biweekly", schedule: { kind: "weekday", weekday: 5 }, nextDate: "2026-10-09" });
    // New Year's Day 2027 is a Friday: that paycheck lands on Thursday, Dec 31.
    expect(occurrences(s, "2026-10-01", "2027-01-20")).toEqual(["2026-10-09", "2026-10-23", "2026-11-06", "2026-11-20", "2026-12-04", "2026-12-18", "2026-12-31", "2027-01-15"]);
  });

  it("knows the last business day of the month", () => {
    const s = only(["2026-04-30", "2026-05-29", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30"], "2026-10-05");
    expect(s.schedule).toEqual({ kind: "monthDays", days: [31] });
    // Counting a month from Sep 30 would say Oct 30, Nov 30, Dec 30.
    expect(occurrences(s, "2026-10-06", "2026-12-31")).toEqual(["2026-10-30", "2026-11-30", "2026-12-31"]);
  });

  it("knows the second Wednesday (Social Security), and pays the day before Veterans Day", () => {
    const s = only(["2026-06-10", "2026-07-08", "2026-08-12", "2026-09-09"], "2026-09-20", "SSA TREAS 310");
    expect(s).toMatchObject({ cadence: "monthly", schedule: { kind: "nthWeekday", weekday: 3, nth: 2 }, nextDate: "2026-10-14" });
    expect(occurrences(s, "2026-10-01", "2026-11-30")).toEqual(["2026-10-14", "2026-11-10"]);
  });

  it("knows one day of the month, and which day it moved from", () => {
    const s = only(["2026-05-15", "2026-06-15", "2026-07-15", "2026-08-14", "2026-09-15"], "2026-09-20");
    expect(s.schedule).toEqual({ kind: "monthDays", days: [15] });
    expect(occurrences(s, "2026-10-01", "2026-11-30")).toEqual(["2026-10-15", "2026-11-13"]);
  });

  it("keeps no rule for money that lands when banks are shut, like interest posted on a Sunday", () => {
    const s = only(["2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30"], "2026-10-05", "Interest earned", "sav");
    expect(s.cadence).toBe("monthly");
    expect(s.schedule).toBeUndefined();
  });

  it("gives no rule to money going out, however regular", () => {
    const [s] = detectRecurring(monthly(months, 15, -7_000, "Fiberly Internet", "bills", "card"), "2026-09-20");
    expect(s!.schedule).toBeUndefined();
  });
});
