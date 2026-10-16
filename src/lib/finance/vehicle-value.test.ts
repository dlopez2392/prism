import { describe, expect, it } from "vitest";
import { cleanMiles, cleanVin, milesToday, validVehicleValues, vehicleValuationDue } from "./vehicle-value";
import type { ManualItem } from "./manual";

const KEY = "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";

describe("a vehicle's VIN", () => {
  it("is taken as copied off a card, and only with its check digit right", () => {
    expect(cleanVin("1hgcm82633a004352")).toBe("1HGCM82633A004352");
    expect(cleanVin(" 2T1BU RHE3E-C020936 ")).toBe("2T1BURHE3EC020936");
    // One character off, and the check digit catches it.
    expect(cleanVin("1HGCM82633A004353")).toBeNull();
    expect(cleanVin("2T1BURHE4EC020936")).toBeNull();
    // Never I, O or Q; never short; never not text.
    expect(cleanVin("1HGCM82633A0O4352")).toBeNull();
    expect(cleanVin("1HGCM82633A00435")).toBeNull();
    expect(cleanVin(12345)).toBeNull();
  });
});

describe("its mileage", () => {
  it("is a whole number of miles as a person types it", () => {
    expect(cleanMiles("48,250")).toBe(48_250);
    expect(cleanMiles(" 0 ")).toBe(0);
    expect(cleanMiles("48.5")).toBeNull();
    expect(cleanMiles("-3")).toBeNull();
    expect(cleanMiles("99999999")).toBeNull();
    expect(cleanMiles(null)).toBeNull();
  });

  it("grows by the average driven since it was given, so an old reading doesn't keep a car young", () => {
    expect(milesToday(null, "2026-10-16")).toBeNull();
    expect(milesToday({ miles: 48_250, on: "2026-10-16" }, "2026-10-16")).toBe(48_300);
    // A year on: about 13,500 more.
    expect(milesToday({ miles: 48_250, on: "2025-10-16" }, "2026-10-16")).toBe(61_700);
    // A reading dated after today (a clock moved) never takes miles away.
    expect(milesToday({ miles: 48_250, on: "2026-11-16" }, "2026-10-16")).toBe(48_300);
  });
});

describe("what's stored", () => {
  it("keeps each valid vehicle on its own, and never two for one item", () => {
    const good = { itemId: "civic", vin: "1HGCM82633A004352", mileage: { miles: 48_250, on: "2026-10-16" }, key: KEY, estimate: { low: 900_000, high: 1_300_000, on: "2026-10-16" } };
    const stored = {
      v: 1,
      vehicles: [
        good,
        { ...good },
        { ...good, itemId: "bad-vin", vin: "1HGCM82633A004353" },
        { ...good, itemId: "no-key", key: "x" },
        { ...good, itemId: "odd", mileage: { miles: -1, on: "2026-10-16" }, estimate: { low: 2, high: 1, on: "2026-10-16" } },
      ],
    };
    expect(validVehicleValues(stored)).toEqual([good, { ...good, itemId: "odd", mileage: null, estimate: null }]);
    expect(validVehicleValues({ v: 2, vehicles: [good] })).toEqual([]);
    expect(validVehicleValues(null)).toEqual([]);
  });

  it("is due an estimate once a month, only for a vehicle VinAudit keeps, and never over a figure already there", () => {
    const car: ManualItem = { id: "civic", kind: "vehicle", name: "Civic", values: [{ month: "2026-09", value: 1_000_000, estimated: true }] };
    const kept = validVehicleValues({ v: 1, vehicles: [{ itemId: "civic", vin: "1HGCM82633A004352", mileage: null, key: KEY, estimate: null }] })[0];
    expect(vehicleValuationDue(car, kept, "2026-10")).toBe(true);
    expect(vehicleValuationDue(car, kept, "2026-09")).toBe(false);
    expect(vehicleValuationDue(car, undefined, "2026-10")).toBe(false);
    expect(vehicleValuationDue({ ...car, kind: "asset" }, kept, "2026-10")).toBe(false);
  });
});
