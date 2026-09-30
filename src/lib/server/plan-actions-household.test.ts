// The household's budgets and goals through the editors' actions
// (plan-actions.ts): only for a signed-in member, written from the version
// the member saw, never over someone else's newer budgets, and each goal edit
// applied to the latest goals so nobody's other goals are put back.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoalSettings } from "@/lib/finance/plan";

vi.mock("server-only", () => ({}));
const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));
vi.mock("./finance", () => ({
  requestToday: async () => "2026-09-30",
  readSources: async () => ({ plan: { budgets: null, goals: [] } }),
  sourceGoals: async () => [],
}));
const saveAccountBudgets = vi.fn(async () => undefined);
const saveAccountGoals = vi.fn(async () => undefined);
vi.mock("./account-store", () => ({ saveAccountBudgets, saveAccountGoals }));
const signedIn = { current: null as unknown };
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => signedIn.current }));

const { deleteGoal, resetBudgets, saveBudgets, saveGoal, setGoalMonthly } = await import("./plan-actions");

type Row = { budgets: unknown; goals: unknown; budgets_version: number; goals_version: number; budgets_changed_by_name: string | null; budgets_changed_at: string | null; goals_changed_by_name: string | null; goals_changed_at: string | null };

const samsGoal: GoalSettings = { id: "car", name: "Car", emoji: "🚗", target: 1_000_000, saved: 0, monthlyContribution: 50_000, targetDate: "2027-12-31", colorSlot: 1 };

/** A member whose household keeps its plan the way the database does: a write names its version or is refused. */
function member({ inHousehold = true, before }: { inHousehold?: boolean; before?: (row: Row, fn: string) => void } = {}) {
  const row: Row = { budgets: null, goals: null, budgets_version: 0, goals_version: 0, budgets_changed_by_name: null, budgets_changed_at: null, goals_changed_by_name: null, goals_changed_at: null };
  const writes: { fn: string; args: Record<string, unknown> }[] = [];
  const supabase = {
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      if (fn === "household_plan") return { data: inHousehold ? [{ ...row }] : [], error: null };
      if (!inHousehold) return { data: null, error: { code: "42501", message: "not in a household" } };
      before?.(row, fn);
      const list = fn === "set_household_budgets" ? "budgets" : "goals";
      if (args.p_version !== row[`${list}_version`]) return { data: null, error: { code: "40001", message: "someone else changed these first" } };
      writes.push({ fn, args });
      row[list] = args[`p_${list}`];
      row[`${list}_version`] += 1;
      row[`${list}_changed_by_name`] = "Dana";
      row[`${list}_changed_at`] = "2026-09-30T12:00:00Z";
      return { data: row[`${list}_version`], error: null };
    },
  };
  signedIn.current = { userId: "u-dana", email: "dana@example.com", supabase };
  return { row, writes };
}
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const IDLE = { status: "idle" as const };
const goalForm = (fields: Record<string, string>) => form({ scope: "household", emoji: "🗾", target: "5000", saved: "500", monthly: "200", month: "6", year: "2027", ...fields });

afterEach(() => {
  signedIn.current = null;
  refresh.mockClear();
  saveAccountBudgets.mockClear();
  saveAccountGoals.mockClear();
});

describe("the household's budgets", () => {
  it("need a signed-in member", async () => {
    expect(await saveBudgets(IDLE, form({ scope: "household", version: "0", "limit:food": "600" }))).toMatchObject({ status: "error", message: expect.stringMatching(/Sign in/) });
  });

  it("save for everyone, from the version the member was looking at, and never touch the member's own", async () => {
    const { row, writes } = member();
    const res = await saveBudgets(IDLE, form({ scope: "household", version: "0", "limit:food": "600", "limit:transport": "150.50" }));
    expect(res).toMatchObject({ status: "saved", message: expect.stringMatching(/Everyone in your household/) });
    expect(writes).toEqual([{ fn: "set_household_budgets", args: { p_budgets: [{ category: "food", limit: 60_000 }, { category: "transport", limit: 15_050 }], p_version: 0 } }]);
    expect(row.budgets_version).toBe(1);
    expect(refresh).toHaveBeenCalled();
    expect(saveAccountBudgets).not.toHaveBeenCalled();
  });

  it("refuse to overwrite budgets someone changed since, and say who", async () => {
    const { row, writes } = member();
    Object.assign(row, { budgets: [{ category: "food", limit: 90_000 }], budgets_version: 1, budgets_changed_by_name: "Sam", budgets_changed_at: "2026-09-30T11:00:00Z" });
    const res = await saveBudgets(IDLE, form({ scope: "household", version: "0", "limit:food": "600" }));
    expect(res).toMatchObject({ status: "error", message: expect.stringMatching(/^Sam changed these budgets a moment ago/) });
    expect(writes).toEqual([]);
    expect(row.budgets).toEqual([{ category: "food", limit: 90_000 }]);
    expect(refresh).toHaveBeenCalled();
  });

  it("turn away a form without a sensible version, asking the database nothing", async () => {
    const { writes } = member();
    for (const version of ["", "-1", "1.5", "abc"]) {
      expect(await saveBudgets(IDLE, form({ scope: "household", version, "limit:food": "600" }))).toMatchObject({ status: "error" });
    }
    expect(writes).toEqual([]);
  });

  it("go back to drafted, for everyone", async () => {
    const { writes } = member();
    expect(await resetBudgets(form({ intent: "reset", scope: "household", version: "0" }))).toMatchObject({ status: "saved", message: expect.stringMatching(/drafted from what your household shares/) });
    expect(writes).toEqual([{ fn: "set_household_budgets", args: { p_budgets: null, p_version: 0 } }]);
  });

  it("say so when the member has left the household", async () => {
    member({ inHousehold: false });
    expect(await saveBudgets(IDLE, form({ scope: "household", version: "0", "limit:food": "600" }))).toMatchObject({ status: "error", message: expect.stringMatching(/not in a household any more/) });
  });

  it("leave the member's own budgets to their own account", async () => {
    const { writes } = member();
    expect(await saveBudgets(IDLE, form({ "limit:food": "600" }))).toMatchObject({ status: "saved", message: "Budgets saved to your account." });
    expect(saveAccountBudgets).toHaveBeenCalledWith(signedIn.current, [{ category: "food", limit: 60_000 }]);
    expect(writes).toEqual([]);
  });
});

describe("the household's goals", () => {
  it("add a goal to the household's latest goals, beside everyone else's", async () => {
    const { row } = member();
    Object.assign(row, { goals: [samsGoal], goals_version: 4 });
    expect(await saveGoal(IDLE, goalForm({ name: "Japan trip" }))).toMatchObject({ status: "saved", message: "Added “Japan trip”." });
    expect(row.goals).toEqual([samsGoal, expect.objectContaining({ id: "japan-trip", name: "Japan trip", target: 500_000, saved: 50_000, colorSlot: 2 })]);
    expect(row.goals_version).toBe(5);
    expect(saveAccountGoals).not.toHaveBeenCalled();
  });

  it("apply an edit to the latest goals when someone saved in between, never putting theirs back", async () => {
    let raced = false;
    const { row, writes } = member({
      before: (r, fn) => {
        // Sam adds a goal the moment Dana's first save is on its way.
        if (fn === "set_household_goals" && !raced) {
          raced = true;
          r.goals = [...(r.goals as GoalSettings[]), { ...samsGoal, id: "sofa", name: "Sofa", colorSlot: 2 }];
          r.goals_version += 1;
        }
      },
    });
    Object.assign(row, { goals: [samsGoal], goals_version: 1 });
    expect(await saveGoal(IDLE, goalForm({ id: "car", name: "New car" }))).toMatchObject({ status: "saved", message: "Saved “New car” for your household." });
    expect((row.goals as GoalSettings[]).map((g) => g.name)).toEqual(["New car", "Sofa"]);
    expect(writes).toHaveLength(1);
  });

  it("give up after a second clash, saying why, and write nothing", async () => {
    const { row, writes } = member({ before: (r, fn) => void (fn === "set_household_goals" && (r.goals_version += 1)) });
    Object.assign(row, { goals: [samsGoal], goals_version: 1 });
    expect(await deleteGoal(IDLE, form({ scope: "household", id: "car" }))).toMatchObject({ status: "error", message: expect.stringMatching(/changing these goals right now/) });
    expect(writes).toEqual([]);
    expect(row.goals).toEqual([samsGoal]);
  });

  it("delete only the goal named, and change only the monthly amount asked", async () => {
    const { row } = member();
    Object.assign(row, { goals: [samsGoal, { ...samsGoal, id: "sofa", name: "Sofa", colorSlot: 2 }], goals_version: 2 });
    expect(await setGoalMonthly(IDLE, form({ scope: "household", id: "sofa", monthly: "7500" }))).toMatchObject({ status: "saved" });
    expect(await deleteGoal(IDLE, form({ scope: "household", id: "car" }))).toMatchObject({ status: "saved", message: "Deleted “Car”." });
    expect(row.goals).toEqual([{ ...samsGoal, id: "sofa", name: "Sofa", colorSlot: 2, monthlyContribution: 7_500 }]);
    expect(await deleteGoal(IDLE, form({ scope: "household", id: "car" }))).toMatchObject({ status: "error", message: "That goal is already gone." });
  });

  it("need a signed-in member in a household", async () => {
    expect(await saveGoal(IDLE, goalForm({ name: "Trip" }))).toMatchObject({ status: "error", message: expect.stringMatching(/Sign in/) });
    member({ inHousehold: false });
    expect(await saveGoal(IDLE, goalForm({ name: "Trip" }))).toMatchObject({ status: "error", message: expect.stringMatching(/not in a household any more/) });
  });

  it("stop at the most goals Prism tracks", async () => {
    const { row, writes } = member();
    Object.assign(row, { goals: Array.from({ length: 8 }, (_, i) => ({ ...samsGoal, id: `g${i}`, colorSlot: i + 1 })) });
    expect(await saveGoal(IDLE, goalForm({ name: "One more" }))).toMatchObject({ status: "error", message: expect.stringMatching(/up to 8 goals/) });
    expect(writes).toEqual([]);
  });
});
