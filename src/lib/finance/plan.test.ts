import { describe, expect, it } from "vitest";
import { buildDemoData } from "./demo";
import {
  applyPlan,
  cleanGoalName,
  dollarsInput,
  goalId,
  goalSettings,
  MAX_GOALS,
  monthEndOf,
  nextColorSlot,
  parseDollars,
  readBudgetForm,
  readGoalForm,
  toGoal,
  validBudgets,
  validGoals,
  type GoalSettings,
} from "./plan";

const TODAY = "2026-09-27";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

const goal = (over: Partial<GoalSettings> = {}): GoalSettings => ({
  id: "japan",
  name: "Japan trip",
  emoji: "🗾",
  target: 650_000,
  saved: 312_000,
  monthlyContribution: 35_000,
  targetDate: "2027-04-30",
  colorSlot: 2,
  ...over,
});

describe("parseDollars", () => {
  it("reads the ways people type money", () => {
    expect(parseDollars("1950")).toBe(195_000);
    expect(parseDollars("$1,950.5")).toBe(195_050);
    expect(parseDollars(" 19.99 ")).toBe(1_999);
    expect(parseDollars("0")).toBe(0);
  });

  it("refuses anything that isn't a plain amount", () => {
    for (const bad of ["", "-5", "1e3", "12.345", "1.2k", "abc", "$", "1 000", "0x10", "Infinity"]) expect(parseDollars(bad)).toBeNull();
  });

  it("round-trips through the editor's display form", () => {
    for (const cents of [0, 1_999, 195_000, 100_050]) expect(parseDollars(dollarsInput(cents))).toBe(cents);
  });
});

describe("monthEndOf", () => {
  it("means the last day of the month, leap years included", () => {
    expect(monthEndOf("2028-02")).toBe("2028-02-29");
    expect(monthEndOf("2027-04")).toBe("2027-04-30");
    expect(monthEndOf("2027-13")).toBeNull();
    expect(monthEndOf("27-04")).toBeNull();
  });
});

describe("cleanGoalName", () => {
  it("trims, collapses spaces and strips control characters", () => {
    expect(cleanGoalName("  Japan \n trip\u0007 ")).toBe("Japan trip");
  });

  it("counts characters, not bytes, against the limit", () => {
    expect(cleanGoalName("🏖️".repeat(10))).not.toBeNull();
    expect(cleanGoalName("x".repeat(33))).toBeNull();
    expect(cleanGoalName("   ")).toBeNull();
    expect(cleanGoalName(42)).toBeNull();
  });
});

describe("validBudgets", () => {
  it("accepts a well-formed list and returns it in category order", () => {
    expect(
      validBudgets([
        { category: "food", limit: 90_000 },
        { category: "housing", limit: 200_000 },
      ]),
    ).toEqual([
      { category: "housing", limit: 200_000 },
      { category: "food", limit: 90_000 },
    ]);
    expect(validBudgets([])).toEqual([]);
  });

  it("throws away the whole list when anything is off", () => {
    expect(validBudgets([{ category: "income", limit: 1 }])).toBeNull();
    expect(validBudgets([{ category: "food", limit: 1.5 }])).toBeNull();
    expect(validBudgets([{ category: "food", limit: 0 }])).toBeNull();
    expect(validBudgets([{ category: "food", limit: 10 }, { category: "food", limit: 20 }])).toBeNull();
    expect(validBudgets([{ category: "food", limit: 10 }, null])).toBeNull();
    expect(validBudgets({ category: "food", limit: 10 })).toBeNull();
    expect(validBudgets(undefined)).toBeNull();
  });
});

describe("validGoals", () => {
  it("accepts goals it could have written itself", () => {
    expect(validGoals([goal()])).toEqual([goal()]);
  });

  it("rejects tampered or foreign values", () => {
    expect(validGoals([goal({ name: " Japan trip" })])).toBeNull();
    expect(validGoals([goal({ emoji: "<script>" })])).toBeNull();
    expect(validGoals([goal({ id: "Japan Trip" })])).toBeNull();
    expect(validGoals([goal(), goal()])).toBeNull();
    expect(validGoals([goal({ targetDate: "2027-02-30" })])).toBeNull();
    expect(validGoals([goal({ colorSlot: 9 })])).toBeNull();
    expect(validGoals([goal({ saved: -1 })])).toBeNull();
    expect(validGoals(Array.from({ length: MAX_GOALS + 1 }, (_, i) => goal({ id: `g${i}` })))).toBeNull();
  });

  it("drops extra fields rather than carrying them along", () => {
    const [g] = validGoals([{ ...goal(), history: [1, 2, 3], admin: true }])!;
    expect(Object.keys(g!).sort()).toEqual(Object.keys(goal()).sort());
  });
});

describe("applyPlan", () => {
  const data = buildDemoData(TODAY);

  it("leaves the source alone when nothing was edited", () => {
    expect(applyPlan(data, { budgets: null, goals: null })).toEqual(data);
  });

  it("replaces the budget list whole", () => {
    const out = applyPlan(data, { budgets: [{ category: "food", limit: 1 }], goals: null });
    expect(out.budgets).toEqual([{ category: "food", limit: 1 }]);
    expect(out.goals).toBe(data.goals);
  });

  it("keeps a known goal's history and moves only its latest point", () => {
    const base = data.goals.find((g) => g.id === "japan")!;
    const unchanged = toGoal({ ...goalSettings(base), name: "Tokyo" }, base);
    expect(unchanged.history).toEqual(base.history);
    const corrected = toGoal({ ...goalSettings(base), saved: 400_000 }, base);
    expect(corrected.history.slice(0, -1)).toEqual(base.history.slice(0, -1));
    expect(corrected.history.at(-1)).toBe(400_000);
  });

  it("gives a goal made on this device one honest point, not an invented past", () => {
    const out = applyPlan(data, { budgets: null, goals: [goal({ id: "boat", saved: 5_000 })] });
    expect(out.goals).toHaveLength(1);
    expect(out.goals[0]!.history).toEqual([5_000]);
  });
});

describe("goal ids and colours", () => {
  it("makes a readable id that never collides", () => {
    expect(goalId("Japan trip!", [])).toBe("japan-trip");
    expect(goalId("Japan trip", ["japan-trip", "japan-trip-2"])).toBe("japan-trip-3");
    expect(goalId("🏡🏡", [])).toBe("goal");
    expect(goalId("Crème brûlée fund for the whole family", [])).toMatch(/^[a-z0-9-]{1,24}$/);
  });

  it("hands out the lowest colour no other goal wears", () => {
    expect(nextColorSlot([goal({ colorSlot: 1 }), goal({ colorSlot: 3 })])).toBe(2);
    expect(nextColorSlot([])).toBe(1);
  });
});

describe("readBudgetForm", () => {
  it("treats blank and zero as no budget", () => {
    expect(readBudgetForm(form({ "limit:housing": "1,950", "limit:food": "", "limit:fun": "0" }))).toEqual({
      budgets: [{ category: "housing", limit: 195_000 }],
    });
  });

  it("names every bad line and saves none of them", () => {
    const out = readBudgetForm(form({ "limit:housing": "1950", "limit:food": "lots", "limit:travel": "2000000" }));
    expect(out).toEqual({ errors: { food: expect.any(String), travel: expect.any(String) } });
  });

  it("ignores fields that aren't spending categories", () => {
    expect(readBudgetForm(form({ "limit:income": "5000" }))).toEqual({ budgets: [] });
  });
});

describe("readGoalForm", () => {
  const valid = { name: " New  car ", emoji: "🚗", target: "12,000", saved: "", monthly: "400", month: "3", year: "2028" };

  it("reads a complete goal, a blank 'saved' meaning none yet", () => {
    expect(readGoalForm(form(valid), TODAY)).toEqual({
      goal: { name: "New car", emoji: "🚗", target: 1_200_000, saved: 0, monthlyContribution: 40_000, targetDate: "2028-03-31" },
    });
  });

  it("accepts this month but not last month", () => {
    expect("goal" in readGoalForm(form({ ...valid, month: "9", year: "2026" }), TODAY)).toBe(true);
    expect(readGoalForm(form({ ...valid, month: "8", year: "2026" }), TODAY)).toEqual({ errors: { targetDate: expect.any(String) } });
  });

  it("explains each missing or wrong field", () => {
    const out = readGoalForm(form({ ...valid, name: "", emoji: "💣", target: "0", monthly: "-4" }), TODAY);
    expect(out).toEqual({
      errors: { name: expect.any(String), emoji: expect.any(String), target: expect.any(String), monthly: expect.any(String) },
    });
  });
});
