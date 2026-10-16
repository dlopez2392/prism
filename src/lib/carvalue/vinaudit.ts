// src/lib/carvalue/vinaudit.ts
//
// A vehicle's value from VinAudit's Market Values API (GET /v2/marketvalue):
// what comparable vehicles have sold for, adjusted for mileage. Switched on by
// VINAUDIT_API_KEY. Only the VIN and the mileage are sent: no name, no
// account, nothing else about the person. VinAudit bills every request, so
// this is never called without the database's go-ahead first
// (claim_vehicle_value_lookup, supabase/migrations/20261016120000_vehicle_values.sql).
//
// VinAudit takes its key in the query string, so the address asked is never
// logged or put in an error: it carries the key.
//
// Pure apart from the request, which takes an injectable fetch.

import type { Cents } from "@/lib/finance/types";

type Env = Record<string, string | undefined>;

export const VINAUDIT_API_URL = "https://marketvalue.vinaudit.com/v2";

/** On only when the operator has set a key. */
export function vehicleValuesEnabled(env: Env = process.env): boolean {
  return (env.VINAUDIT_API_KEY ?? "").trim().length > 0;
}

/** The market value and its usual range, and the vehicle VinAudit took the VIN to be ("2019 Honda Civic LX"). */
export type VehicleEstimate = { value: Cents; low: Cents; high: Cents; vehicle: string | null };

/** Why there's no estimate: a VIN VinAudit can't value, a key it refused, or no answer. */
export class VehicleValueError extends Error {
  constructor(readonly reason: "not-found" | "refused" | "unavailable") {
    super(`vehicle value ${reason}`);
    this.name = "VehicleValueError";
  }
}

const cents = (x: unknown): Cents | null => (typeof x === "number" && Number.isFinite(x) && x > 0 && x < 1e8 ? Math.round(x * 100) : null);

/** VinAudit's own error codes, as it names them (docs: Market Values API, "Error Responses"). */
const REFUSED = new Set(["api_not_enabled", "invalid_key", "missing_key"]);
const NOT_FOUND = new Set(["no_data", "invalid_vin"]);

/** The vehicle's name as VinAudit gives it, kept plain: letters, digits and a little punctuation, within a name's length. */
function vehicleName(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const s = x.replace(/[^\p{L}\p{N} .,&'/-]/gu, "").replace(/\s+/g, " ").trim();
  return s.length >= 4 ? s.slice(0, 40).trim() : null;
}

export async function estimateVehicleValue(vin: string, mileage: number | null, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<VehicleEstimate> {
  const key = (env.VINAUDIT_API_KEY ?? "").trim();
  if (!key) throw new VehicleValueError("refused");
  const base = (env.VINAUDIT_API_URL ?? "").trim() || VINAUDIT_API_URL;
  const query = new URLSearchParams({ key, vin, format: "json", period: "90", mileage: mileage === null ? "average" : String(mileage) });
  let res: Response;
  try {
    res = await fetchImpl(`${base}/marketvalue?${query}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  } catch {
    throw new VehicleValueError("unavailable");
  }
  if (res.status === 401 || res.status === 403) throw new VehicleValueError("refused");
  if (!res.ok) throw new VehicleValueError(res.status === 400 || res.status === 404 ? "not-found" : "unavailable");
  let body: { success?: unknown; error?: unknown; data?: unknown; mean?: unknown; vehicle?: unknown; prices?: { average?: unknown; below?: unknown; above?: unknown } };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new VehicleValueError("unavailable");
  }
  if (body.success !== true) {
    const code = [body.data, body.error].find((c): c is string => typeof c === "string" && /^[a-z_]+$/.test(c)) ?? "";
    throw new VehicleValueError(REFUSED.has(code) ? "refused" : NOT_FOUND.has(code) ? "not-found" : "unavailable");
  }
  const value = cents(body.prices?.average) ?? cents(body.mean);
  if (value === null) throw new VehicleValueError("not-found");
  const low = cents(body.prices?.below) ?? value;
  const high = cents(body.prices?.above) ?? value;
  return { value, low: Math.min(low, value), high: Math.max(high, value), vehicle: vehicleName(body.vehicle) };
}
