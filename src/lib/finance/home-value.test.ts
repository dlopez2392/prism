import { describe, expect, it } from "vitest";
import { cleanAddress, validHomeValues, valuationDue } from "./home-value";
import { validManualItems, withValue, type ManualItem } from "./manual";

const KEY = "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
const home = (over: Record<string, unknown> = {}) => ({ itemId: "our-house", address: "12 Maple Ct, Austin, TX 78701", key: KEY, estimate: null, ...over });

describe("a home's address", () => {
  it("is taken as typed, tidied, with a number and a street in it", () => {
    expect(cleanAddress("  12  Maple Ct,\nAustin, TX 78701 ")).toBe("12 Maple Ct, Austin, TX 78701");
    expect(cleanAddress("12\tMaple Ct, Austin, TX")).toBe("12 Maple Ct, Austin, TX");
    expect(cleanAddress("12 Maple Ct\u0000, Austin")).toBe("12 Maple Ct , Austin");
    expect(cleanAddress("Maple Court")).toBeNull();
    expect(cleanAddress("12345678")).toBeNull();
    expect(cleanAddress("1 A")).toBeNull();
    expect(cleanAddress("9".repeat(161))).toBeNull();
    expect(cleanAddress(42)).toBeNull();
  });
});

describe("what's stored about homes", () => {
  it("keeps each valid home on its own, and never two for one item", () => {
    const stored = {
      v: 1,
      homes: [
        home({ estimate: { low: 39_000_000, high: 43_100_000, on: "2026-09-29" } }),
        home({ address: "90 Oak Ave, Austin, TX 78702" }),
        home({ itemId: "cabin", key: "not-a-uuid" }),
        home({ itemId: "Bad Id" }),
        home({ itemId: "lake", estimate: { low: 5, high: 1, on: "2026-09-29" } }),
      ],
    };
    expect(validHomeValues(stored)).toEqual([
      { itemId: "our-house", address: "12 Maple Ct, Austin, TX 78701", key: KEY, estimate: { low: 39_000_000, high: 43_100_000, on: "2026-09-29" } },
      // A range that doesn't hold together is dropped, not the home.
      { itemId: "lake", address: "12 Maple Ct, Austin, TX 78701", key: KEY, estimate: null },
    ]);
    expect(validHomeValues({ v: 2, homes: [home()] })).toEqual([]);
    expect(validHomeValues(null)).toEqual([]);
  });

  it("is due an estimate only while nothing is this month's value yet", () => {
    const item: ManualItem = { id: "our-house", kind: "home", name: "Our house", values: [{ month: "2026-08", value: 40_000_000 }] };
    const v = validHomeValues({ v: 1, homes: [home()] })[0]!;
    expect(valuationDue(item, v, "2026-09")).toBe(true);
    expect(valuationDue(item, undefined, "2026-09")).toBe(false);
    expect(valuationDue(withValue(item, "2026-09", 41_000_000), v, "2026-09")).toBe(false);
    expect(valuationDue(withValue(item, "2026-09", 41_000_000, true), v, "2026-09")).toBe(false);
    expect(valuationDue({ ...item, kind: "asset" }, v, "2026-09")).toBe(false);
  });

  it("marks an estimated month, and the mark survives being stored", () => {
    const item: ManualItem = { id: "our-house", kind: "home", name: "Our house", values: [{ month: "2026-08", value: 40_000_000 }] };
    const estimated = withValue(item, "2026-09", 41_200_000, true);
    expect(estimated.values).toEqual([{ month: "2026-08", value: 40_000_000 }, { month: "2026-09", value: 41_200_000, estimated: true }]);
    expect(validManualItems([estimated])).toEqual([estimated]);
    // Anything but `true` isn't a mark.
    expect(validManualItems([{ ...item, values: [{ month: "2026-08", value: 1, estimated: "yes" }] }])[0]!.values).toEqual([{ month: "2026-08", value: 1 }]);
    // A person's own figure replaces an estimate for its month, unmarked.
    expect(withValue(estimated, "2026-09", 42_000_000).values.at(-1)).toEqual({ month: "2026-09", value: 42_000_000 });
  });
});
