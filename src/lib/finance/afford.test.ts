// "Can I afford it?" (afford.ts): a purchase, a new monthly payment or a raise,
// tested against the checking forecast, safe-to-spend and what the person
// usually keeps, with an answer in plain words and the figures behind it.

import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import { buildDemoData } from "./demo";
import { affordBase, AFFORD_MAX, scenarioFlows, tryScenario, usualMonthlyKept, validScenario, type AffordBase } from "./afford";
import type { ForecastEvent } from "./forecast";
import { analyze } from "./model";
import type { Goal } from "./types";

const TODAY = "2026-10-04";

/** A flat forecast: the balance stays put, a paycheck on the 15th, rent on the 1st. */
function base(over: Partial<AffordBase> = {}): AffordBase {
  const balance = over.balance ?? 300_000;
  const events: ForecastEvent[] = [
    { date: "2026-10-15", merchant: "Acme Payroll", amount: 250_000, kind: "income", variable: false },
    { date: "2026-11-01", merchant: "Oak Street Rent", amount: -180_000, kind: "bill", variable: false },
  ];
  const points = Array.from({ length: 61 }, (_, i) => {
    const date = addDays(TODAY, i);
    return { date, expected: balance + events.filter((e) => e.date <= date).reduce((s, e) => s + e.amount, 0) };
  });
  return { today: TODAY, balance, cushion: 25_000, points, events, monthlyKept: 60_000, goals: [], ...over };
}

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: "trip",
  name: "Japan trip",
  emoji: "🗾",
  target: 500_000,
  saved: 100_000,
  monthlyContribution: 40_000,
  targetDate: "2027-06-30",
  history: [],
  colorSlot: 1,
  ...over,
});

describe("a scenario someone typed", () => {
  it("is a purchase, a monthly payment or a raise, a positive amount, and a real day from today to a year out", () => {
    expect(validScenario({ kind: "once", amount: 120_000, date: TODAY }, TODAY)).toEqual({ kind: "once", amount: 120_000, date: TODAY });
    expect(validScenario({ kind: "raise", amount: 1, date: "2027-10-04" }, TODAY)).not.toBeNull();
    for (const bad of [
      null,
      "once",
      { kind: "loan", amount: 100, date: TODAY },
      { kind: "once", amount: 0, date: TODAY },
      { kind: "once", amount: -5, date: TODAY },
      { kind: "once", amount: 12.5, date: TODAY },
      { kind: "once", amount: AFFORD_MAX + 1, date: TODAY },
      { kind: "once", amount: 100, date: "2026-10-03" },
      { kind: "once", amount: 100, date: "2027-10-06" },
      { kind: "once", amount: 100, date: "2026-02-30" },
      { kind: "once", amount: 100, date: "2026-11-31" },
      { kind: "once", amount: 100, date: "soon" },
    ]) {
      expect(validScenario(bad, TODAY)).toBeNull();
    }
  });

  it("lands once, or on the same day each month (the last day in a short month)", () => {
    expect(scenarioFlows({ kind: "once", amount: 5_000, date: "2026-10-20" }, "2026-12-03")).toEqual([{ date: "2026-10-20", amount: -5_000 }]);
    expect(scenarioFlows({ kind: "once", amount: 5_000, date: "2027-01-01" }, "2026-12-03")).toEqual([]);
    expect(scenarioFlows({ kind: "monthly", amount: 40_000, date: "2026-10-31" }, "2026-12-31")).toEqual([
      { date: "2026-10-31", amount: -40_000 },
      { date: "2026-11-30", amount: -40_000 },
      { date: "2026-12-31", amount: -40_000 },
    ]);
    expect(scenarioFlows({ kind: "raise", amount: 30_000, date: "2026-11-15" }, "2026-12-03")).toEqual([{ date: "2026-11-15", amount: 30_000 }]);
  });
});

describe("one purchase", () => {
  it("fits when checking stays above the cushion, and says how many months of keeping it is", () => {
    const v = tryScenario(base(), { kind: "once", amount: 90_000, date: TODAY });
    expect(v.answer).toBe("yes");
    expect(v.lowest).toEqual({ date: TODAY, balance: 210_000 });
    expect(v.lowestBefore).toEqual({ date: TODAY, balance: 300_000 });
    expect(v.safeBefore).toBe(275_000);
    expect(v.safeAfter).toBe(185_000);
    expect(v.reasons.join(" ")).toMatch(/about 1\.5 months of what you usually keep \(\$600 a month\)/);
  });

  it("is tight under the cushion, and a no below zero, naming the day", () => {
    expect(tryScenario(base(), { kind: "once", amount: 290_000, date: TODAY })).toMatchObject({ answer: "tight", lowest: { balance: 10_000 } });
    // A cent below zero is below zero.
    expect(tryScenario(base(), { kind: "once", amount: 300_001, date: TODAY })).toMatchObject({ answer: "no", lowest: { balance: -1 } });
    // After the Oct 15 paycheck it would fit; rent on Nov 1 then takes checking below zero.
    const no = tryScenario(base(), { kind: "once", amount: 400_000, date: "2026-10-20" });
    expect(no).toMatchObject({ answer: "no", lowest: { date: "2026-11-01", balance: -30_000 } });
    expect(no.reasons[0]).toBe("Checking would drop to -$300 around Nov 1, below zero.");
    expect(no.headline).toMatch(/checking would run out/);
  });

  it("says when it lands past the forecast, and leaves checking as it stands", () => {
    const v = tryScenario(base(), { kind: "once", amount: 90_000, date: "2027-01-15" });
    expect(v.lowest).toEqual(v.lowestBefore);
    expect(v.reasons.join(" ")).toMatch(/after the 60 days/);
  });
});

describe("a new monthly payment", () => {
  it("fits while what you keep still covers your goals", () => {
    const v = tryScenario(base({ goals: [goal({ monthlyContribution: 10_000 })] }), { kind: "monthly", amount: 30_000, date: "2026-11-05" });
    expect(v).toMatchObject({ answer: "yes", keptBefore: 60_000, keptAfter: 30_000, goalsMonthly: 10_000 });
    expect(v.reasons.join(" ")).toMatch(/still usually keep about \$300 a month, enough for your goals' \$100/);
  });

  it("is tight when it would crowd out the goals it used to leave room for", () => {
    const v = tryScenario(base({ goals: [goal()] }), { kind: "monthly", amount: 30_000, date: "2026-11-05" });
    expect(v.answer).toBe("tight");
    expect(v.reasons.join(" ")).toMatch(/Your goals ask for \$400 a month; you'd usually keep about \$300/);
  });

  it("calls it tight when goals were already short, and says they were", () => {
    const v = tryScenario(base({ goals: [goal({ monthlyContribution: 90_000 })] }), { kind: "monthly", amount: 10_000, date: "2026-11-05" });
    expect(v.answer).toBe("tight");
    expect(v.reasons.join(" ")).toMatch(/already ask for more than you usually keep \(\$900 against \$600\); this would leave about \$500/);
  });

  it("is a no when it costs more than you usually keep, even if checking holds for now", () => {
    const v = tryScenario(base(), { kind: "monthly", amount: 70_000, date: "2026-11-05" });
    expect(v).toMatchObject({ answer: "no", keptAfter: -10_000 });
    expect(v.headline).toMatch(/costs more than you usually keep/);
    expect(v.lowest.balance).toBeGreaterThan(0);
  });

  it("counts every month inside the forecast against checking", () => {
    // Oct 10 and Nov 10 both fall inside the 60 days: the second is what takes checking below zero.
    const v = tryScenario(base(), { kind: "monthly", amount: 200_000, date: "2026-10-10" });
    expect(v.lowest).toEqual({ date: "2026-11-10", balance: 300_000 - 200_000 + 250_000 - 180_000 - 200_000 });
    expect(v.answer).toBe("no");
  });

  it("answers from checking alone when there aren't three full months to tell what you keep", () => {
    const v = tryScenario(base({ monthlyKept: null }), { kind: "monthly", amount: 70_000, date: "2026-11-05" });
    expect(v).toMatchObject({ answer: "yes", keptBefore: null, keptAfter: null });
  });
});

describe("a raise", () => {
  it("is always room to plan with, and says which goal it would bring forward the most", () => {
    const behind = goal({ id: "car", name: "New car", target: 1_000_000, saved: 0, monthlyContribution: 20_000, targetDate: "2027-12-31" });
    const v = tryScenario(base({ goals: [goal(), behind] }), { kind: "raise", amount: 30_000, date: "2026-11-01" });
    expect(v).toMatchObject({ answer: "yes", keptAfter: 90_000 });
    // 50 months at $200; 20 at $500.
    expect(v.reasons).toContain("Put into New car, it would be done by June 2028, 30 months sooner.");
    expect(v.reasons[0]).toBe("You'd usually keep about $900 a month, up from $600.");
    expect(v.lowest.balance).toBeGreaterThanOrEqual(v.lowestBefore.balance);
  });

  it("never stands in for the next paycheck, so safe-to-spend still counts the bills before it", () => {
    const bill: ForecastEvent = { date: "2026-10-12", merchant: "Phone", amount: -100_000, kind: "bill", variable: false };
    const b = base();
    const withBill = { ...b, events: [bill, ...b.events], points: b.points.map((p) => (p.date >= bill.date ? { ...p, expected: p.expected + bill.amount } : p)) };
    const v = tryScenario(withBill, { kind: "raise", amount: 30_000, date: "2026-10-10" });
    expect(v.safeBefore).toBe(175_000);
    expect(v.safeAfter).toBe(175_000);
  });
});

describe("what you usually keep", () => {
  const flows = [
    { month: "2026-06", net: 10_000 },
    { month: "2026-07", net: 20_000 },
    { month: "2026-08", net: 30_000 },
    { month: "2026-09", net: 40_000 },
    { month: "2026-10", net: -99_000 },
  ];

  it("averages the last three full months, never this one", () => {
    expect(usualMonthlyKept(flows, TODAY, "2025-01-01")).toBe(30_000);
  });

  it("needs three months Prism saw from their first day", () => {
    expect(usualMonthlyKept(flows, TODAY, "2026-07-01")).toBe(30_000);
    expect(usualMonthlyKept(flows, TODAY, "2026-07-02")).toBeNull();
    expect(usualMonthlyKept(flows, TODAY, null)).toBeNull();
  });
});

describe("the example household", () => {
  it("is tested against the same forecast the Future page draws", () => {
    const a = analyze(buildDemoData(TODAY));
    const b = affordBase(a)!;
    expect(b.points).toEqual(a.forecast!.points.map((p) => ({ date: p.date, expected: p.expected })));
    expect(b.monthlyKept).not.toBeNull();
    const v = tryScenario(b, { kind: "once", amount: 1, date: TODAY });
    expect(v.safeBefore).toBe(a.safe!.amount);
    expect(v.lowestBefore).toEqual(a.forecast!.lowest);
  });
});
