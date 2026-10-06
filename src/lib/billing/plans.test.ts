// Prism Plus as data: the prices the page shows are the prices Stripe is
// asked for, a subscription's plan is read back from its price's name, and
// once Plus ends the same connection keeps updating every time.

import { describe, expect, it } from "vitest";
import { EN } from "@/lib/i18n/t";
import { FREE_CONNECTIONS, isPlusFeature, LOOKUP_KEYS, pausedBeyondFree, PLUS_NEEDS, planOfLookupKey, plusNeeds, priceLabel, PRICES, pricingFor, yearlySaving } from "./plans";

describe("the plans", () => {
  it("cost what was approved: $5.99 or $49, and $8.99 or $79 for a household", () => {
    expect(PRICES).toEqual({ plus: { month: 599, year: 4900 }, household: { month: 899, year: 7900 } });
    expect([priceLabel(599), priceLabel(4900), priceLabel(899), priceLabel(7900)]).toEqual(["$5.99", "$49", "$8.99", "$79"]);
    // A year is always the better deal, and the saving is never overstated.
    expect(yearlySaving("plus")).toBe(31);
    expect(yearlySaving("household")).toBe(26);
  });

  it("are read back from the name of the price a subscription is on, and only Prism's own", () => {
    for (const plan of ["plus", "household"] as const) {
      for (const interval of ["month", "year"] as const) expect(planOfLookupKey(LOOKUP_KEYS[plan][interval])).toEqual({ plan, interval });
    }
    // A later price under a new name (the founding offer ended) still reads as its plan.
    expect(planOfLookupKey("prism_plus_monthly_2027")).toEqual({ plan: "plus", interval: "month" });
    for (const other of ["prism_pro_monthly", "plus_monthly", "prism_plus_weekly", "PRISM_PLUS_MONTHLY", null, 7]) expect(planOfLookupKey(other)).toBeNull();
  });

  it("name every part of Plus a free account can reach, and only those", () => {
    for (const feature of Object.keys(PLUS_NEEDS)) {
      expect(isPlusFeature(feature)).toBe(true);
      expect(plusNeeds(feature as keyof typeof PLUS_NEEDS, EN)).toMatch(/comes? with Prism Plus\.$/);
      expect(pricingFor(feature as keyof typeof PLUS_NEEDS)).toBe(`/pricing?need=${feature}`);
    }
    for (const other of ["toString", "__proto__", "", "everything", 1]) expect(isPlusFeature(other)).toBe(false);
  });
});

describe("once Prism Plus ends", () => {
  it("keeps the first connection made up to date and pauses the rest, whatever order they're listed in", () => {
    const banks = [
      { itemId: "c", linkedAt: "2026-10-03T00:00:00Z" },
      { itemId: "a", linkedAt: "2026-09-30T00:00:00Z" },
      { itemId: "b", linkedAt: "2026-10-01T00:00:00Z" },
    ];
    expect(FREE_CONNECTIONS).toBe(1);
    expect([...pausedBeyondFree(banks)].sort()).toEqual(["b", "c"]);
    expect([...pausedBeyondFree([...banks].reverse())].sort()).toEqual(["b", "c"]);
    expect(pausedBeyondFree([banks[0]!]).size).toBe(0);
    expect(pausedBeyondFree([]).size).toBe(0);
  });
});
