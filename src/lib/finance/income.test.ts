import { describe, expect, it } from "vitest";
import { buildDemoData } from "./demo";
import { incomeKind, incomeSummary, payerName, paychecks, scheduleText } from "./income";
import { analyze } from "./model";
import { detectRecurring } from "./recurring";
import { tx } from "./test-helpers";

describe("what kind of income it is", () => {
  it("takes the bank's word first, then the name's", () => {
    expect(incomeKind({ incomeKind: "dividends", merchant: "Acme payroll" })).toBe("dividends");
    expect(incomeKind({ merchant: "ACME CORP DIR DEP 0925" })).toBe("pay");
    expect(incomeKind({ merchant: "SSA TREAS 310" })).toBe("benefits");
    expect(incomeKind({ merchant: "IRS TREAS 310 TAX REF" })).toBe("tax-refund");
    expect(incomeKind({ merchant: "Interest earned" })).toBe("interest");
    expect(incomeKind({ merchant: "Studio Kiln — client payment" })).toBe("other");
  });

  it("names the payer, not the payroll run", () => {
    expect(payerName("Lumen Design Co. payroll")).toBe("Lumen Design Co.");
    expect(payerName("ACME CORP DIR DEP 0925")).toBe("ACME CORP");
    expect(payerName("SSA TREAS 310")).toBe("SSA TREAS");
    expect(payerName("Payroll")).toBe("Payroll");
  });

  it("says when pay comes the way a person would", () => {
    expect(scheduleText("biweekly", { kind: "weekday", weekday: 5 })).toBe("Every other Friday");
    expect(scheduleText("weekly", { kind: "weekday", weekday: 4 })).toBe("Every Thursday");
    expect(scheduleText("semimonthly", { kind: "monthDays", days: [15, 31] })).toBe("The 15th and the last day of each month");
    expect(scheduleText("semimonthly", { kind: "monthDays", days: [1, 15] })).toBe("The 1st and 15th of each month");
    expect(scheduleText("monthly", { kind: "monthDays", days: [31] })).toBe("The last day of each month");
    expect(scheduleText("monthly", { kind: "monthDays", days: [22] })).toBe("The 22nd of each month");
    expect(scheduleText("monthly", { kind: "nthWeekday", weekday: 3, nth: 2 })).toBe("The second Wednesday of each month");
    expect(scheduleText("monthly", { kind: "nthWeekday", weekday: 5, nth: -1 })).toBe("The last Friday of each month");
    expect(scheduleText("biweekly", undefined)).toBe("Every two weeks");
  });
});

describe("paychecks", () => {
  const twiceMonthly = ["2026-06-15", "2026-06-30", "2026-07-15", "2026-07-31", "2026-08-14", "2026-08-31", "2026-09-15", "2026-09-30"];

  it("finds pay on its schedule, with what lands, a year of it, and the next payday", () => {
    const txns = [
      ...twiceMonthly.map((d, i) => ({ ...tx(d, i < 6 ? 250_000 : 262_500, "ACME CORP PAYROLL", "income"), id: `p${i}` })),
      // Interest repeats too, but nobody lives on it.
      ...["2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30"].map((d, i) => ({ ...tx(d, 1_210, "Interest earned", "income", "sav"), id: `i${i}` })),
    ];
    const [p, ...rest] = paychecks(detectRecurring(txns, "2026-10-02"), txns);
    expect(rest).toEqual([]);
    expect(p).toMatchObject({
      payer: "ACME CORP",
      kind: "pay",
      cadence: "semimonthly",
      when: "The 15th and the last day of each month",
      takeHome: 262_500,
      perYear: 24,
      yearly: 6_300_000,
      next: "2026-10-15",
      change: { from: 250_000, to: 262_500, date: "2026-09-15" },
    });
    expect(p!.transactionIds).toHaveLength(8);
  });

  it("counts Social Security and a pension as paychecks, by the bank's word or the name's", () => {
    const ssa = ["2026-06-10", "2026-07-08", "2026-08-12", "2026-09-09"].map((d, i) => ({ ...tx(d, 184_000, "SSA TREAS 310", "income"), id: `s${i}` }));
    const [p] = paychecks(detectRecurring(ssa, "2026-09-20"), ssa);
    expect(p).toMatchObject({ kind: "benefits", when: "The second Wednesday of each month", next: "2026-10-14" });
  });
});

describe("the income summary", () => {
  it("averages the last three full months by kind, and names the next paycheck", () => {
    const data = buildDemoData("2026-09-30");
    const s = incomeSummary(data.transactions, detectRecurring(data.transactions, data.today), data.today);
    expect(s.months).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(s.paychecks.map((p) => [p.payer, p.when, p.cadence])).toEqual([["Lumen Design Co.", "Every other Friday", "biweekly"]]);
    expect(s.byKind.map((k) => k.label)).toEqual(["Pay", "Other income", "Interest"].filter((l) => s.byKind.some((k) => k.label === l)));
    expect(s.byKind[0]).toMatchObject({ kind: "pay" });
    expect(s.monthly).toBe(s.byKind.reduce((sum, k) => sum + k.monthly, 0));
    expect(s.steadyMonthly).toBe(Math.round((s.paychecks[0]!.takeHome * 26) / 12));
    expect(s.next).toEqual({ date: s.paychecks[0]!.next, amount: s.paychecks[0]!.takeHome, payer: "Lumen Design Co." });
    expect(s.next!.date > data.today).toBe(true);
  });

  it("averages only over months the history covers from their first day", () => {
    const txns = [tx("2026-08-20", 100_000, "Acme payroll", "income"), tx("2026-09-05", 100_000, "Acme payroll", "income")];
    const s = incomeSummary(txns, [], "2026-10-02");
    // History starts Aug 20: August is partial, so only September counts.
    expect(s.months).toEqual(["2026-09"]);
    expect(s.byKind).toEqual([{ kind: "pay", label: "Pay", monthly: 100_000 }]);
    expect(incomeSummary([], [], "2026-10-02")).toMatchObject({ months: [], byKind: [], monthly: 0, next: null, paychecks: [] });
  });

  it("is part of the one analysis every screen reads", () => {
    const a = analyze(buildDemoData("2026-09-30"));
    expect(a.income.paychecks).toHaveLength(1);
  });
});
