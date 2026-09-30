// src/lib/homevalue/rentcast.ts
//
// A home's value from RentCast's automated valuation (GET /v1/avm/value).
// Switched on by RENTCAST_API_KEY. Only the address is sent: no name, no
// account, nothing else about the person. RentCast bills past the plan's
// allowance, so this is never called without the database's go-ahead first
// (claim_home_value_lookup, supabase/migrations/20260930230000_home_values.sql).
//
// Pure apart from the request, which takes an injectable fetch.

import type { Cents } from "@/lib/finance/types";

type Env = Record<string, string | undefined>;

export const RENTCAST_API_URL = "https://api.rentcast.io/v1";

/** On only when the operator has set a key. */
export function homeValuesEnabled(env: Env = process.env): boolean {
  return (env.RENTCAST_API_KEY ?? "").trim().length > 0;
}

export type HomeEstimate = { value: Cents; low: Cents; high: Cents };

/** Why there's no estimate: an address RentCast can't place, a key it refused, or no answer. */
export class HomeValueError extends Error {
  constructor(readonly reason: "not-found" | "refused" | "unavailable") {
    super(`home value ${reason}`);
    this.name = "HomeValueError";
  }
}

const cents = (x: unknown): Cents | null => (typeof x === "number" && Number.isFinite(x) && x > 0 && x < 1e10 ? Math.round(x * 100) : null);

export async function estimateHomeValue(address: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<HomeEstimate> {
  const key = (env.RENTCAST_API_KEY ?? "").trim();
  if (!key) throw new HomeValueError("refused");
  const base = (env.RENTCAST_API_URL ?? "").trim() || RENTCAST_API_URL;
  const url = `${base}/avm/value?${new URLSearchParams({ address, compCount: "5" })}`;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Accept: "application/json", "X-Api-Key": key }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  } catch {
    throw new HomeValueError("unavailable");
  }
  if (res.status === 404 || res.status === 400) throw new HomeValueError("not-found");
  if (res.status === 401 || res.status === 403) throw new HomeValueError("refused");
  if (!res.ok) throw new HomeValueError("unavailable");
  let body: { price?: unknown; priceRangeLow?: unknown; priceRangeHigh?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new HomeValueError("unavailable");
  }
  const value = cents(body.price);
  if (value === null) throw new HomeValueError("not-found");
  const low = cents(body.priceRangeLow) ?? value;
  const high = cents(body.priceRangeHigh) ?? value;
  return { value, low: Math.min(low, value), high: Math.max(high, value) };
}
