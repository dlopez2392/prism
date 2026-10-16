// Vehicle values from VinAudit (vehicle-values.ts, manual-actions.ts): asked
// only with the database's go-ahead, sent only the VIN and mileage, kept
// sealed apart from the items, and never over a value the person typed.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeValuation } from "@/lib/finance/home-value";
import type { ManualItem } from "@/lib/finance/manual";
import type { VehicleValuation } from "@/lib/finance/vehicle-value";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/i18n/server", async () => ({ getT: async () => (await import("@/lib/i18n/t")).EN }));
vi.mock("./finance", () => ({ requestToday: async () => "2026-10-16" }));
const signedIn = { current: null as unknown };
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => signedIn.current }));

const { deleteManualItem, saveManualItem } = await import("./manual-actions");
const { refreshDueVehicleValues } = await import("./vehicle-values");
const { openPacked, sealPacked, vaultKey } = await import("./vault");

const KEY = randomBytes(32);
const IDLE = { status: "idle" as const };
const VIN = "1HGCM82633A004352";
const CAR_KEY = "8f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
const ESTIMATE = { success: true, vin: VIN, vehicle: "2003 Honda Accord EX", mean: 4_210, prices: { average: 4_210, below: 3_100, above: 5_300 } };
const HOME: HomeValuation = { itemId: "our-house", address: "12 Maple Ct, Austin, TX 78701", key: "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f", estimate: null };

function profileDb(items: ManualItem[] | null, vehicles: VehicleValuation[] = [], answer = "ok", homes: HomeValuation[] = []) {
  const row: Record<string, string | null> = {
    sealed_manual_items: items ? sealPacked(items, KEY) : null,
    sealed_home_values: homes.length ? sealPacked({ v: 1, homes }, KEY) : null,
    sealed_vehicle_values: vehicles.length ? sealPacked({ v: 1, vehicles }, KEY) : null,
  };
  const writes: Record<string, unknown>[] = [];
  const claims: { name: string; args: unknown }[] = [];
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...row }, error: null }) }) }),
      upsert: async (values: Record<string, unknown>) => (writes.push(values), Object.assign(row, values), { error: null }),
    }),
    rpc: async (name: string, args: unknown) => (claims.push({ name, args }), { data: answer, error: null }),
  };
  const account = { userId: "u1", email: "a@x.test", supabase: db };
  signedIn.current = account;
  return {
    row,
    writes,
    claims,
    account: account as never,
    items: () => openPacked(row.sealed_manual_items!, KEY) as ManualItem[],
    vehicles: () => (row.sealed_vehicle_values ? (openPacked(row.sealed_vehicle_values, KEY) as { vehicles: VehicleValuation[] }).vehicles : []),
  };
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

const vinaudit = (body: unknown = ESTIMATE) => {
  const f = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)));
  vi.stubGlobal("fetch", f);
  return f;
};

const accord = (values: ManualItem["values"]): ManualItem => ({ id: "accord", kind: "vehicle", name: "Accord", values });
const valued = (over: Partial<VehicleValuation> = {}): VehicleValuation => ({ itemId: "accord", vin: VIN, mileage: null, key: CAR_KEY, estimate: null, ...over });

beforeEach(() => {
  vi.stubEnv("PRISM_VAULT_KEY", KEY.toString("base64"));
  vi.stubEnv("VINAUDIT_API_KEY", "va-test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  signedIn.current = null;
});

describe("a vehicle VinAudit keeps up to date", () => {
  it("left blank, takes VinAudit's estimate and name, asked with the go-ahead and sent the VIN and mileage alone, kept sealed apart", async () => {
    const db = profileDb(null);
    const f = vinaudit();
    const r = await saveManualItem(IDLE, form({ kind: "vehicle", name: "", value: "", estimate: "on", vin: "1hgcm8 2633a004352", miles: "48,250" }));
    expect(r).toMatchObject({ status: "saved", message: "2003 Honda Accord EX added to your net worth. VinAudit estimates $4,210 (between $3,100 and $5,300)." });

    const [car] = db.vehicles();
    expect(db.claims).toEqual([{ name: "claim_vehicle_value_lookup", args: { p_vehicle_key: car!.key } }]);
    expect(f).toHaveBeenCalledTimes(1);
    const url = new URL(String(f.mock.calls[0]![0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({ key: "va-test-key", vin: VIN, format: "json", period: "90", mileage: "48300" });
    expect(String(f.mock.calls[0]![0])).not.toMatch(/u1|a@x/);

    expect(db.items()).toEqual([{ id: "vehicle", kind: "vehicle", name: "2003 Honda Accord EX", values: [{ month: "2026-10", value: 421_000, estimated: true }] }]);
    expect(car).toEqual({ itemId: "vehicle", vin: VIN, mileage: { miles: 48_250, on: "2026-10-16" }, key: expect.stringMatching(/^[0-9a-f-]{36}$/), estimate: { low: 310_000, high: 530_000, on: "2026-10-16" } });
    // Sealed, and in its own column: the items carry no VIN.
    expect(db.row.sealed_vehicle_values).not.toContain(VIN);
    expect(JSON.stringify(db.items())).not.toContain(VIN);
  });

  it("keeps a value the person typed as theirs for the month, and asks VinAudit nothing", async () => {
    const db = profileDb(null);
    const f = vinaudit();
    expect(await saveManualItem(IDLE, form({ kind: "vehicle", name: "Accord", value: "5,000", estimate: "on", vin: VIN }))).toMatchObject({ status: "saved" });
    expect(db.claims).toEqual([]);
    expect(f).not.toHaveBeenCalled();
    expect(db.items()[0]!.values).toEqual([{ month: "2026-10", value: 500_000 }]);
    expect(db.vehicles()).toEqual([valued({ itemId: "accord", key: expect.any(String) })]);
  });

  it("checks the VIN and mileage before anything is asked, and an unnamed vehicle needs a name when there's no estimate", async () => {
    profileDb(null);
    const f = vinaudit();
    expect(await saveManualItem(IDLE, form({ kind: "vehicle", name: "Accord", value: "", estimate: "on", vin: "1HGCM82633A004353", miles: "lots" }))).toMatchObject({
      status: "error",
      fields: { vin: expect.any(String), miles: expect.any(String) },
    });
    expect(await saveManualItem(IDLE, form({ kind: "vehicle", name: "", value: "5,000", estimate: "on", vin: VIN }))).toMatchObject({ status: "error", fields: { name: expect.any(String) } });
    expect(await saveManualItem(IDLE, form({ kind: "vehicle", name: "", value: "5,000" }))).toMatchObject({ status: "error", fields: { name: expect.any(String) } });
    expect(f).not.toHaveBeenCalled();
  });

  it("asks VinAudit nothing when the database says no, and a new vehicle then needs the person's own figure", async () => {
    for (const [answer, words] of [
      ["limit", /used up for now/],
      ["person-limit", /up to three vehicles a month/],
    ] as const) {
      const db = profileDb(null, [], answer);
      const f = vinaudit();
      const r = await saveManualItem(IDLE, form({ kind: "vehicle", name: "Accord", value: "", estimate: "on", vin: VIN }));
      expect(r).toMatchObject({ status: "error", message: expect.stringMatching(words), fields: { value: expect.any(String) } });
      expect(f).not.toHaveBeenCalled();
      expect(db.writes).toEqual([]);
    }
  });

  it("keeps an existing vehicle's last value when VinAudit has no data for it, and says so", async () => {
    const db = profileDb([accord([{ month: "2026-09", value: 400_000, estimated: true }])], [valued()]);
    vinaudit({ success: false, data: "no_data", vin: VIN });
    const r = await saveManualItem(IDLE, form({ id: "accord", kind: "vehicle", name: "Accord", value: "", estimate: "on", vin: VIN }));
    expect(r).toMatchObject({ status: "saved", message: expect.stringMatching(/enough sales.*Its last value stays/) });
    expect(db.items()[0]!.values).toEqual([{ month: "2026-09", value: 400_000, estimated: true }]);
  });

  it("keeps the mileage's date until the reading changes, and a new VIN is a new vehicle to the limit", async () => {
    const reading = { miles: 40_000, on: "2026-06-01" };
    const db = profileDb([accord([{ month: "2026-10", value: 400_000 }])], [valued({ mileage: reading })]);
    await saveManualItem(IDLE, form({ id: "accord", kind: "vehicle", name: "Accord", value: "4,000", estimate: "on", vin: VIN, miles: "40,000" }));
    expect(db.vehicles()[0]).toMatchObject({ key: CAR_KEY, mileage: reading });
    await saveManualItem(IDLE, form({ id: "accord", kind: "vehicle", name: "Accord", value: "4,000", estimate: "on", vin: VIN, miles: "44,000" }));
    expect(db.vehicles()[0]).toMatchObject({ key: CAR_KEY, mileage: { miles: 44_000, on: "2026-10-16" } });
    await saveManualItem(IDLE, form({ id: "accord", kind: "vehicle", name: "Accord", value: "4,000", estimate: "on", vin: "2T1BURHE3EC020936" }));
    expect(db.vehicles()[0]!.key).not.toBe(CAR_KEY);
  });

  it("forgets the VIN when estimates are turned off, the item stops being a vehicle, or it's removed, and never touches a home's address", async () => {
    const changes: Record<string, string>[] = [
      { id: "accord", kind: "vehicle", name: "Accord", value: "4,000" },
      { id: "accord", kind: "asset", name: "Accord", value: "4,000", estimate: "on", vin: VIN },
    ];
    const ourHouse: ManualItem = { id: "our-house", kind: "home", name: "Our house", values: [{ month: "2026-10", value: 40_000_000 }] };
    for (const change of changes) {
      const db = profileDb([accord([{ month: "2026-09", value: 400_000 }]), ourHouse], [valued()], "ok", [HOME]);
      expect(await saveManualItem(IDLE, form(change))).toMatchObject({ status: "saved" });
      expect(db.row.sealed_vehicle_values).toBeNull();
      expect(db.row.sealed_home_values).not.toBeNull();
    }
    const db = profileDb([accord([{ month: "2026-09", value: 400_000 }])], [valued()]);
    expect(await deleteManualItem(IDLE, form({ id: "accord" }))).toMatchObject({ status: "saved" });
    expect(db.row.sealed_vehicle_values).toBeNull();
  });

  it("offers nothing while VinAudit isn't switched on, and keeps no VIN then", async () => {
    vi.stubEnv("VINAUDIT_API_KEY", "");
    const db = profileDb(null);
    const f = vinaudit();
    expect(await saveManualItem(IDLE, form({ kind: "vehicle", name: "Accord", value: "", estimate: "on", vin: VIN }))).toMatchObject({ status: "error", fields: { value: expect.any(String) } });
    expect(await saveManualItem(IDLE, form({ kind: "vehicle", name: "Accord", value: "4,000", estimate: "on", vin: VIN }))).toMatchObject({ status: "saved" });
    expect(db.row.sealed_vehicle_values ?? null).toBeNull();
    expect(db.claims).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("the monthly estimate on a visit", () => {
  const key = () => vaultKey()!;

  it("estimates each vehicle due this month at today's likely miles, and keeps the homes as they were", async () => {
    const ourHouse: ManualItem = { id: "our-house", kind: "home", name: "Our house", values: [{ month: "2026-10", value: 40_000_000 }] };
    const db = profileDb([accord([{ month: "2026-09", value: 400_000, estimated: true }]), ourHouse], [valued({ mileage: { miles: 40_000, on: "2025-10-16" } })], "ok", [HOME]);
    const homesBefore = db.row.sealed_home_values;
    const f = vinaudit();
    expect(await refreshDueVehicleValues(db.account, key(), "2026-10-16")).toBe(1);
    expect(db.claims).toEqual([{ name: "claim_vehicle_value_lookup", args: { p_vehicle_key: CAR_KEY } }]);
    // A year on from a 40,000-mile reading: about 53,500.
    expect(new URL(String(f.mock.calls[0]![0])).searchParams.get("mileage")).toBe("53500");
    expect(db.items()[0]!.values.at(-1)).toEqual({ month: "2026-10", value: 421_000, estimated: true });
    expect(db.vehicles()[0]!.estimate).toEqual({ low: 310_000, high: 530_000, on: "2026-10-16" });
    expect(openPacked(db.row.sealed_home_values!, KEY)).toEqual(openPacked(homesBefore!, KEY));
  });

  it("never writes over a value the person typed while VinAudit was answering", async () => {
    const db = profileDb([accord([{ month: "2026-09", value: 400_000 }])], [valued()]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        db.row.sealed_manual_items = sealPacked([accord([{ month: "2026-09", value: 400_000 }, { month: "2026-10", value: 390_000 }])], KEY);
        return new Response(JSON.stringify(ESTIMATE));
      }),
    );
    await refreshDueVehicleValues(db.account, key(), "2026-10-16");
    expect(db.items()[0]!.values.at(-1)).toEqual({ month: "2026-10", value: 390_000 });
  });

  it("does nothing without the go-ahead, or while it's switched off", async () => {
    const db = profileDb([accord([{ month: "2026-09", value: 400_000 }])], [valued()], "already");
    const f = vinaudit();
    expect(await refreshDueVehicleValues(db.account, key(), "2026-10-16")).toBe(0);
    expect(f).not.toHaveBeenCalled();
    vi.stubEnv("VINAUDIT_API_KEY", "");
    const off = profileDb([accord([{ month: "2026-09", value: 400_000 }])], [valued()]);
    expect(await refreshDueVehicleValues(off.account, key(), "2026-10-16")).toBe(0);
    expect(off.claims).toEqual([]);
  });
});
