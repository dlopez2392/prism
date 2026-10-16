import { describe, expect, it, vi } from "vitest";
import { estimateVehicleValue, VehicleValueError, vehicleValuesEnabled } from "./vinaudit";

const env = { VINAUDIT_API_KEY: "va-key" };
const VIN = "2T1BURHE3EC020936";
const answer = (status: number, body: unknown) => vi.fn<typeof fetch>(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
const reason = (p: Promise<unknown>) => p.then(() => "none", (e: unknown) => (e instanceof VehicleValueError ? e.reason : "other"));
const VALUED = { success: true, vin: VIN, vehicle: "2014 Toyota Corolla S", mean: 10_880.54, prices: { average: 10_880.54, below: 8_479.55, above: 13_281.53 }, type: "retail" };

describe("VinAudit", () => {
  it("is on only when the operator has set a key", () => {
    expect(vehicleValuesEnabled({})).toBe(false);
    expect(vehicleValuesEnabled({ VINAUDIT_API_KEY: "  " })).toBe(false);
    expect(vehicleValuesEnabled(env)).toBe(true);
  });

  it("sends the VIN and mileage and nothing else, and reads the value and its range in cents", async () => {
    const f = answer(200, VALUED);
    expect(await estimateVehicleValue(VIN, 130_000, env, f)).toEqual({ value: 1_088_054, low: 847_955, high: 1_328_153, vehicle: "2014 Toyota Corolla S" });
    const url = new URL(String(f.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe("https://marketvalue.vinaudit.com/v2/marketvalue");
    expect([...url.searchParams.keys()].sort()).toEqual(["format", "key", "mileage", "period", "vin"]);
    expect(url.searchParams.get("mileage")).toBe("130000");
    // Without the person's mileage, VinAudit's average for that vehicle.
    await estimateVehicleValue(VIN, null, env, f);
    expect(new URL(String(f.mock.calls[1]![0])).searchParams.get("mileage")).toBe("average");
  });

  it("never trusts a range that leaves the value out, nor a vehicle name that isn't plain words", async () => {
    expect(await estimateVehicleValue(VIN, null, env, answer(200, { ...VALUED, prices: { average: 10_000, below: 12_000 }, vehicle: "<b>2014 Corolla</b>\u0000" }))).toEqual({
      value: 1_000_000,
      low: 1_000_000,
      high: 1_000_000,
      vehicle: "b2014 Corolla/b",
    });
    expect((await estimateVehicleValue(VIN, null, env, answer(200, { ...VALUED, vehicle: null }))).vehicle).toBeNull();
  });

  it("says why there's no estimate: a VIN it can't value, a refused key, or no answer", async () => {
    const ask = (f: typeof fetch, e: Record<string, string> = env) => reason(estimateVehicleValue(VIN, null, e, f));
    expect(await ask(answer(200, { success: false, data: "no_data", error: "An error occurred." }))).toBe("not-found");
    expect(await ask(answer(200, { success: false, error: "invalid_vin" }))).toBe("not-found");
    expect(await ask(answer(200, { ...VALUED, mean: 0, prices: {} }))).toBe("not-found");
    expect(await ask(answer(200, { success: false, error: "invalid_key" }))).toBe("refused");
    expect(await ask(answer(403, {}))).toBe("refused");
    expect(await ask(answer(200, VALUED), {})).toBe("refused");
    expect(await ask(answer(200, { success: false, error: "billing_limit_exceeded" }))).toBe("unavailable");
    expect(await ask(answer(503, {}))).toBe("unavailable");
    expect(await ask(answer(200, "<html>"))).toBe("unavailable");
    expect(await ask(vi.fn(async () => Promise.reject(new TypeError("fetch failed"))))).toBe("unavailable");
  });

  it("never puts its key in an error", async () => {
    const e = (await estimateVehicleValue(VIN, null, env, answer(500, {})).then(
      () => null,
      (x: unknown) => x as Error,
    ))!;
    expect(String(e.message) + String(e.stack)).not.toContain("va-key");
  });
});
