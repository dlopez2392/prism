// Getting started (setup.ts): four counted steps, two that apply only to
// some, each done by the thing itself.

import { describe, expect, it } from "vitest";
import { setupOpen, setupSteps, type SetupInput } from "./setup";

const fresh: SetupInput = { ownMoney: false, budgetsSet: false, alertsAvailable: true, alertsOn: false, calendarFeed: false, businessAccounts: 0, taxReturns: 0 };

describe("getting started", () => {
  it("counts a bank, budgets, alerts and the calendar, and lists the business account and the return apart", () => {
    const steps = setupSteps(fresh);
    expect(steps.filter((s) => s.core).map((s) => s.id)).toEqual(["bank", "budgets", "alerts", "calendar"]);
    expect(steps.filter((s) => !s.core).map((s) => s.id)).toEqual(["business", "return"]);
    expect(setupOpen(steps)).toBe(true);
  });

  it("leaves alerts out where this site can't send them", () => {
    expect(setupSteps({ ...fresh, alertsAvailable: false }).map((s) => s.id)).not.toContain("alerts");
  });

  it("is done when every counted step is, whatever the ones that only apply to some say", () => {
    const steps = setupSteps({ ...fresh, ownMoney: true, budgetsSet: true, alertsOn: true, calendarFeed: true });
    expect(setupOpen(steps)).toBe(false);
    expect(steps.find((s) => s.id === "business")?.done).toBe(false);
    expect(setupSteps({ ...fresh, businessAccounts: 1, taxReturns: 1 }).filter((s) => !s.core).every((s) => s.done)).toBe(true);
  });
});
