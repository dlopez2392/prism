// Your own inflation rate (inflation.ts): the same things bought again, now
// against a year ago, weighted by what's spent on them; typical visits apart.

import { describe, expect, it } from "vitest";
import { inflationFor } from "./inflation";
import { tx } from "./test-helpers";

const TODAY = "2026-10-21";

/** A monthly charge on the 5th: `then` through last October, `now` from this August. */
function monthly(merchant: string, then: number, now: number, category: Parameters<typeof tx>[3] = "bills") {
  return [
    tx("2025-09-05", -then, merchant, category),
    tx("2025-10-05", -then, merchant, category),
    tx("2025-11-05", -then, merchant, category),
    tx("2026-09-05", -now, merchant, category),
    tx("2026-10-05", -now, merchant, category),
  ];
}

describe("own inflation", () => {
  it("weighs each price change by what's spent on it now", () => {
    const f = inflationFor([...monthly("Rent Co", 150_000, 154_500, "housing"), ...monthly("Streamy", 1_000, 1_200, "fun"), ...monthly("Power", 8_000, 8_000)], TODAY);
    expect(f.prices.map((p) => [p.name, p.before, p.after])).toEqual([
      ["Rent Co", 150_000, 154_500],
      ["Streamy", 1_000, 1_200],
      ["Power", 8_000, 8_000],
    ]);
    // 3% on rent and 20% on a small subscription: the rent carries the rate.
    expect(f.rate).toBeCloseTo((0.03 * 154_500 + 0.2 * 1_200) / (154_500 + 1_200 + 8_000), 5);
    expect(f.extraYearly).toBeGreaterThan(0);
  });

  it("takes a price that rose this month from its latest charge", () => {
    const lines = [...monthly("Streamy", 1_000, 1_000, "fun").slice(0, 4), tx("2026-10-05", -1_300, "Streamy", "fun"), ...monthly("Power", 8_000, 8_000)];
    expect(inflationFor(lines, TODAY).prices.find((p) => p.name === "Streamy")).toMatchObject({ before: 1_000, after: 1_300 });
  });

  it("never reads a one-off as a price, a loan payment, or a basket as a price", () => {
    const lines = [
      tx("2025-10-10", -30_000, "Tech Hub", "shopping"),
      tx("2026-10-10", -15_000, "Tech Hub", "shopping"),
      ...monthly("Harbor Auto Finance payment", 38_900, 38_900, "transport"),
      // A grocer's baskets differ week to week: a typical visit, never a price.
      ...[
        ["2025-09-25", 8_000],
        ["2025-10-02", 6_400],
        ["2025-10-09", 9_200],
        ["2025-10-16", 7_300],
        ["2026-09-01", 9_100],
        ["2026-09-15", 7_000],
        ["2026-10-01", 10_200],
        ["2026-10-15", 8_300],
      ].map(([d, a]) => tx(d as string, -(a as number), "Grocer", "food")),
    ];
    const f = inflationFor(lines, TODAY);
    expect(f.prices).toEqual([]);
    expect(f.rate).toBeNull();
    expect(f.visits.map((v) => [v.name, v.before, v.after])).toEqual([["Grocer", 7_650, 8_700]]);
  });

  it("needs two prices to state a rate", () => {
    expect(inflationFor(monthly("Streamy", 1_000, 1_200, "fun"), TODAY).rate).toBeNull();
  });
});
