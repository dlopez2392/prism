import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { BUDGETS_COOKIE, encodePlanValue, GOALS_COOKIE, readPlan } = await import("./plan-store");

const jar = (values: Record<string, string>) => ({
  get: (name: string) => (name in values ? { value: values[name]! } : undefined),
});

const goals = [
  {
    id: "boat",
    name: "Sailboat ⛵ fund",
    emoji: "🏖️",
    target: 1_000_000,
    saved: 25_000,
    monthlyContribution: 50_000,
    targetDate: "2029-06-30",
    colorSlot: 5,
  },
];

describe("plan cookies", () => {
  it("round-trips budgets and goals, unicode names included", () => {
    const plan = readPlan(
      jar({
        [BUDGETS_COOKIE]: encodePlanValue([{ category: "food", limit: 90_000 }]),
        [GOALS_COOKIE]: encodePlanValue(goals),
      }),
    );
    expect(plan).toEqual({ budgets: [{ category: "food", limit: 90_000 }], goals });
  });

  it("encodes to cookie-safe characters only", () => {
    expect(encodePlanValue(goals)).toMatch(/^1\.[A-Za-z0-9_-]+$/);
  });

  it("means 'not edited' for a missing, foreign or tampered cookie", () => {
    expect(readPlan(jar({}))).toEqual({ budgets: null, goals: null });
    const tampered = encodePlanValue([{ category: "food", limit: -5 }]);
    const unversioned = Buffer.from(JSON.stringify([{ category: "food", limit: 5 }])).toString("base64url");
    for (const value of [tampered, unversioned, "1.%%%", "1.", "2.W10"]) {
      expect(readPlan(jar({ [BUDGETS_COOKIE]: value })).budgets).toBeNull();
    }
  });

  it("refuses an oversized value before parsing it", () => {
    expect(readPlan(jar({ [GOALS_COOKIE]: `1.${"A".repeat(5_000)}` })).goals).toBeNull();
  });
});
