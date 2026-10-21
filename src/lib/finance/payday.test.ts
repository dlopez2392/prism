// The payday plan (payday.ts): the last paycheck, given a job for every
// dollar until the next one.

import { describe, expect, it } from "vitest";
import { buildDemoData } from "./demo";
import { analyze } from "./model";
import { paydayPlan } from "./payday";
import { detectRecurring } from "./recurring";
import { monthly, tx } from "./test-helpers";
import type { Goal } from "./types";

const TODAY = "2026-10-21";
// Paid the 1st and the 15th; rent on the 16th, phone on the 25th, a streaming plan on the 3rd.
const PAYDAYS = ["2026-06-01", "2026-06-15", "2026-07-01", "2026-07-15", "2026-08-03", "2026-08-14", "2026-09-01", "2026-09-15", "2026-10-01", "2026-10-15"];
const MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const goal = (over: Partial<Goal> = {}): Goal => ({ id: "g", name: "Emergency fund", emoji: "🛟", target: 500_000, saved: 100_000, monthlyContribution: 30_440, targetDate: "2027-12-31", history: [], colorSlot: 1, ...over });

describe("payday plan", () => {
  const txns = [
    ...PAYDAYS.map((d) => tx(d, 210_000, "Acme Payroll", "income")),
    ...monthly(MONTHS, 16, -140_000, "Oak Street Rent", "housing"),
    ...monthly(["2026-05", ...MONTHS.slice(0, 4)], 25, -6_500, "Pulse Mobile", "bills"),
    ...monthly(MONTHS, 3, -1_549, "Streamflix", "fun"),
    tx("2026-10-18", -8_000, "Fresh Market", "food"),
    tx("2026-10-20", -2_000, "Shell", "transport"),
  ];

  it("gives the paycheck a job: bills before the next payday, the goals' share, and the rest to live on", () => {
    const p = paydayPlan({ transactions: txns, goals: [goal()], today: TODAY }, detectRecurring(txns, TODAY))!;
    expect(p).toMatchObject({ payday: "2026-10-15", nextPayday: "2026-10-30", paycheck: 210_000, payers: ["Acme"] });
    expect(p.bills.map((b) => [b.name, b.date, b.paid])).toEqual([
      ["Oak Street Rent", "2026-10-16", true],
      ["Pulse Mobile", "2026-10-25", false],
    ]);
    expect(p.billsTotal).toBe(146_500);
    // 15 days of a $304.40 monthly goal.
    expect(p.goals).toEqual([{ name: "Emergency fund", amount: 15_000 }]);
    expect(p.toLiveOn).toBe(210_000 - 146_500 - 15_000);
    // Groceries and fuel, not the rent.
    expect(p.spent).toBe(10_000);
    expect(p).toMatchObject({ left: 38_500, daysLeft: 9, perDay: 4_277 });
  });

  it("says nothing without a paycheck to plan", () => {
    expect(paydayPlan({ transactions: [], goals: [], today: TODAY }, [])).toBeNull();
  });

  it("works on the example household, agreeing with its forecast's next payday", () => {
    const d = buildDemoData(TODAY);
    const a = analyze(d);
    const p = paydayPlan(d, a.streams)!;
    expect(p).not.toBeNull();
    expect(p.nextPayday).toBe(a.safe!.until);
    expect(p.paycheck).toBeGreaterThan(0);
  });
});
