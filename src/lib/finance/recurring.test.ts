import { describe, expect, it } from "vitest";
import { dailyDriftStats, forecastBalance, safeToSpend } from "./forecast";
import { generateInsights } from "./insights";
import { detectRecurring, monthlyCost, occurrences, perYear, setAside, type RecurringStream } from "./recurring";
import { addDays } from "./dates";
import { monthly, tx } from "./test-helpers";
import type { CategoryId, Transaction } from "./types";

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

describe("bills that don't come every month", () => {
  const charges = (merchant: string, category: CategoryId, dated: [string, number][], account = "chk"): Transaction[] => dated.map(([d, amount]) => tx(d, amount, merchant, category, account));
  const one = (txns: Transaction[], today: string): RecurringStream | null => {
    const found = detectRecurring(txns, today);
    expect(found.length).toBeLessThanOrEqual(1);
    return found[0] ?? null;
  };

  it("finds a yearly renewal from two charges, expects the latest amount, and spreads it over twelve months", () => {
    const s = one(charges("Guardline Auto Insurance", "transport", [["2025-03-14", -84_000], ["2026-03-12", -91_000]]), "2026-09-20");
    expect(s).toMatchObject({ cadence: "annual", kind: "bill", amount: -91_000, variable: true, nextDate: "2027-03-12", occurrences: 2 });
    expect(monthlyCost(s!)).toBe(7_583);
  });

  it("finds twice a year, and every three months however much the amount moves once there are three", () => {
    const hoa = one(charges("Lakeview HOA", "housing", [["2025-04-02", -46_500], ["2025-10-01", -46_500], ["2026-04-01", -46_500]]), "2026-09-20");
    expect(hoa).toMatchObject({ cadence: "semiannual", amount: -46_500, variable: false, nextDate: "2026-10-01" });
    expect(occurrences(hoa!, "2026-09-21", "2027-12-31")).toEqual(["2026-10-01", "2027-04-01", "2027-10-01"]);
    // Summer's water bill is much bigger: the rhythm is the evidence, not the amount.
    const water = one(charges("Clearwater Water & Sewer", "bills", [["2025-12-06", -4_900], ["2026-03-06", -7_215], ["2026-06-06", -11_960], ["2026-09-06", -7_480]]), "2026-09-20");
    expect(water).toMatchObject({ cadence: "quarterly", amount: -7_480, variable: true, nextDate: "2026-12-06" });
    expect(monthlyCost(water!)).toBe(2_493);
    expect([perYear("quarterly"), perYear("semiannual"), perYear("annual")]).toEqual([4, 2, 1]);
  });

  it("keeps a month-end bill on the month's end, counted from the last real charge", () => {
    const s = one(charges("Storage Unit", "housing", [["2025-07-31", -30_000], ["2025-10-31", -30_000], ["2026-01-31", -30_000]]), "2026-02-01");
    expect(occurrences(s!, "2026-02-01", "2026-12-31")).toEqual(["2026-04-30", "2026-07-31", "2026-10-31"]);
    const leap = one(charges("Domain renewal", "bills", [["2027-02-28", -2_000], ["2028-02-29", -2_000]]), "2028-03-01");
    expect(occurrences(leap!, "2028-03-01", "2030-12-31")).toEqual(["2029-02-28", "2030-02-28"]);
    // The same day next year, across a leap day, not 365 days on.
    expect(one(charges("Domain renewal", "bills", [["2026-03-01", -2_000], ["2027-03-01", -2_000]]), "2027-03-05")!.nextDate).toBe("2028-03-01");
  });

  it("refuses two charges whose amounts are far apart, two quarterly ones, and a third visit off the rhythm", () => {
    expect(one(charges("Tech Hub", "shopping", [["2025-06-01", -12_000], ["2026-06-02", -42_000]]), "2026-09-20")).toBeNull();
    // Within 30% of the latest passes; past it doesn't.
    expect(one(charges("Tech Hub", "shopping", [["2025-06-01", -7_000], ["2026-06-02", -10_000]]), "2026-09-20")).toMatchObject({ cadence: "annual" });
    expect(one(charges("Tech Hub", "shopping", [["2025-06-01", -6_900], ["2026-06-02", -10_000]]), "2026-09-20")).toBeNull();
    expect(one(charges("Clearwater Water & Sewer", "bills", [["2026-03-06", -7_000], ["2026-06-06", -7_000]]), "2026-07-01")).toBeNull();
    expect(one(charges("Home Nest", "shopping", [["2025-06-01", -5_000], ["2025-11-15", -5_000], ["2026-06-01", -5_000]]), "2026-09-20")).toBeNull();
  });

  it("needs most gaps to fit: three in four is a rhythm with one late charge, two in four isn't", () => {
    const quarters = (first: string, second: string) =>
      charges("Lakeview HOA", "housing", [[first, -30_000], [second, -30_000], ["2025-12-06", -30_000], ["2026-03-06", -30_000], ["2026-06-06", -30_000]]);
    expect(one(quarters("2025-05-22", "2025-09-06"), "2026-07-01")).toMatchObject({ cadence: "quarterly", nextDate: "2026-09-06" });
    expect(one(quarters("2025-05-22", "2025-09-20"), "2026-07-01")).toBeNull();
    // Two in three isn't enough either, even when the odd gap is only a day past what fits.
    const late = charges("Lakeview HOA", "housing", [["2025-01-01", -30_000], ["2025-04-02", -30_000], ["2025-07-02", -30_000], ["2025-10-10", -30_000]]);
    expect(one(late, "2025-11-01")).toBeNull();
  });

  it("allows a charge to move a little each time, and no more", () => {
    const pair = (a: string, b: string) => charges("Domain renewal", "bills", [[a, -2_000], [b, -2_000]]);
    // A year is 365¼ days, give or take 15.
    expect(one(pair("2025-01-01", "2025-12-18"), "2026-01-10")).toMatchObject({ cadence: "annual" });
    expect(one(pair("2025-01-01", "2025-12-17"), "2026-01-10")).toBeNull();
    expect(one(pair("2025-01-01", "2026-01-16"), "2026-01-20")).toMatchObject({ cadence: "annual" });
    expect(one(pair("2025-01-01", "2026-01-17"), "2026-01-20")).toBeNull();
    // Six months is 182.6 days, give or take 12; three is 91.3, give or take 8.
    expect(one(pair("2025-01-01", "2025-07-14"), "2025-08-01")).toMatchObject({ cadence: "semiannual" });
    expect(one(pair("2025-01-01", "2025-07-15"), "2025-08-01")).toBeNull();
    const three = (gap: number) => charges("Clearwater Water & Sewer", "bills", [["2025-01-01", -7_000], [addDays("2025-01-01", gap), -7_000], [addDays("2025-01-01", 2 * gap), -7_000]]);
    expect(one(three(99), "2025-07-10")).toMatchObject({ cadence: "quarterly" });
    expect(one(three(100), "2025-07-10")).toBeNull();
    expect(one(three(84), "2025-06-10")).toMatchObject({ cadence: "quarterly" });
    expect(one(three(83), "2025-06-10")).toBeNull();
  });

  it("gives each a little grace past its date, then counts it stopped", () => {
    // Every three months: two weeks. Every six: three weeks. (Every year: a month, below.)
    const water = charges("Clearwater Water & Sewer", "bills", [["2025-12-06", -7_000], ["2026-03-06", -7_000], ["2026-06-06", -7_000]]);
    expect(one(water, "2026-09-19")).toMatchObject({ cadence: "quarterly" });
    expect(one(water, "2026-09-20")).toBeNull();
    const lenses = charges("ClearSight Lenses", "health", [["2025-11-17", -9_600], ["2026-05-17", -9_600]], "card");
    expect(one(lenses, "2026-12-06")).toMatchObject({ cadence: "semiannual" });
    expect(one(lenses, "2026-12-07")).toBeNull();
  });

  it("never comes from money moving between accounts, meals or trips, nor from money coming in", () => {
    const yearly = (merchant: string, category: CategoryId, amount: number) => charges(merchant, category, [["2025-07-01", amount], ["2026-07-01", amount]]);
    for (const txns of [
      yearly("Seaside Inn", "travel", -60_000),
      yearly("Thanksgiving dinner", "food", -18_000),
      yearly("Transfer to IRA", "transfer", -700_000),
      yearly("Holiday bonus", "income", 300_000),
      yearly("Tax refund", "other", 120_000),
    ]) {
      expect(detectRecurring(txns, "2026-09-20")).toEqual([]);
    }
  });

  it("stops once a renewal is a month late, and until then lands the late one on the first day ahead", () => {
    const insurance = charges("Guardline Auto Insurance", "transport", [["2024-08-02", -84_000], ["2025-08-01", -91_000]]);
    expect(detectRecurring(insurance, "2026-09-20")).toEqual([]);
    const late = one(insurance, "2026-08-20");
    expect(late).toMatchObject({ cadence: "annual", nextDate: "2026-08-01" });
    expect(occurrences(late!, "2026-08-21", "2026-09-30")).toEqual(["2026-08-21"]);
    // Thirty days past the year is the last day it's still expected.
    expect(one(insurance, "2026-08-31")).toMatchObject({ cadence: "annual" });
    expect(one(insurance, "2026-09-01")).toBeNull();
  });

  it("reads two years back and no further, and leaves a monthly bill monthly, read from the last 200 days", () => {
    const three = one(charges("Parcelpass membership", "shopping", [["2024-01-10", -13_900], ["2025-01-10", -13_900], ["2026-01-10", -13_900]]), "2026-09-20");
    expect(three).toMatchObject({ cadence: "annual", occurrences: 2 });
    const twoYears = Array.from({ length: 24 }, (_, i) => `${2024 + Math.floor((i + 9) / 12)}-${String(((i + 9) % 12) + 1).padStart(2, "0")}`);
    const rent = one(monthly(twoYears, 1, -195_000, "Maple Court Apartments", "housing"), "2026-09-20");
    expect(rent).toMatchObject({ cadence: "monthly", nextDate: "2026-10-01" });
    // April to September: March 1 is more than 200 days back.
    expect(rent!.occurrences).toBe(6);
  });

  it("are bills to plan for, even a small fixed plan that would be a subscription if it came monthly", () => {
    expect(one(charges("Tunely Music yearly plan", "fun", [["2025-08-03", -9_900], ["2026-08-03", -9_900]]), "2026-09-20")).toMatchObject({ cadence: "annual", kind: "bill" });
    // Two monthly charges aren't a rhythm yet, monthly or otherwise.
    expect(detectRecurring(monthly(["2026-08", "2026-09"], 3, -1_199, "Tunely Music", "fun"), "2026-09-20")).toEqual([]);
  });

  it("are listed soonest first with what to put aside for them each month; nothing that comes monthly, nothing coming in", () => {
    const streams = detectRecurring(
      [
        ...charges("Guardline Auto Insurance", "transport", [["2025-03-14", -84_000], ["2026-03-12", -91_000]]),
        ...charges("Lakeview HOA", "housing", [["2025-04-02", -46_500], ["2025-10-01", -46_500], ["2026-04-01", -46_500]]),
        ...monthly(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"], 3, -1_199, "Tunely Music", "fun"),
        ...charges("Quarterly dividend", "income", [["2025-12-15", 4_000], ["2026-03-15", 4_000], ["2026-06-15", 4_000], ["2026-09-15", 4_000]], "brk"),
      ],
      "2026-09-20",
    );
    const { bills, monthly: perMonth } = setAside(streams);
    expect(bills.map((b) => b.merchant)).toEqual(["Lakeview HOA", "Guardline Auto Insurance"]);
    expect(perMonth).toBe(7_750 + 7_583);
    expect(setAside([])).toEqual({ bills: [], monthly: 0 });
  });
});

describe("what a bill that comes once a year changes", () => {
  const today = "2026-09-20";
  const fuel = ["2026-07-03", "2026-07-08", "2026-07-29", "2026-08-07", "2026-09-02", "2026-09-05"].map((d) => tx(d, -4_500, "Fuel Stop", "transport"));
  const renewal = [tx("2025-09-14", -86_000, "Guardline Auto Insurance", "transport"), tx("2026-09-12", -91_000, "Guardline Auto Insurance", "transport")];

  it("is no longer day-to-day spending, and no longer a one-off purchase to flag", () => {
    const txns = [...fuel, ...renewal];
    const streams = detectRecurring(txns, today);
    const ids = new Set(streams.flatMap((s) => s.transactionIds));
    expect(dailyDriftStats(txns, "chk", ids, today).mean).toBeCloseTo(-27_000 / 90, 6);
    expect(generateInsights({ txns, today, budgets: [], streams, flows: [] }).some((i) => i.id.startsWith("oneoff-"))).toBe(false);
    // Seen only once, it's still the purchase it looks like.
    const once = [...fuel, renewal[1]!];
    expect(generateInsights({ txns: once, today, budgets: [], streams: detectRecurring(once, today), flows: [] }).some((i) => i.id.startsWith("oneoff-"))).toBe(true);
  });

  it("is in the forecast and counted against safe-to-spend when it's due before payday", () => {
    const streams = detectRecurring([tx("2024-10-06", -86_000, "Guardline Auto Insurance", "transport"), tx("2025-10-05", -91_000, "Guardline Auto Insurance", "transport")], today);
    const forecast = forecastBalance({ startBalance: 250_000, today, horizonDays: 60, streams, drift: { mean: 0, std: 0 } });
    expect(forecast.events).toEqual([{ date: "2026-10-05", merchant: "Guardline Auto Insurance", amount: -91_000, kind: "bill", variable: true }]);
    const pay = { date: "2026-10-09", merchant: "Acme payroll", amount: 250_000, kind: "income" as const, variable: false };
    expect(safeToSpend(250_000, today, [...forecast.events, pay])).toMatchObject({ committed: 91_000, amount: 250_000 - 91_000 - 25_000 });
  });
});
