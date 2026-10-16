// src/lib/finance/vehicle-value.ts
//
// A vehicle whose value VinAudit keeps up to date: its VIN and mileage (what
// VinAudit is sent), the random key its lookups are counted by (never its
// name or VIN), and the last estimate's range. Kept sealed on the person's own
// profile, apart from the items themselves (profiles.sealed_vehicle_values),
// so a VIN never travels with what they share with a household. Read back as
// untrusted input: an invalid entry is dropped, alone.
//
// An estimate becomes the vehicle's value for its month, marked as an
// estimate (manual.ts). A value the person types for a month is theirs: no
// estimate replaces it, and the next estimate waits for the next month.
//
// Mileage is what the person last told Prism. A car keeps being driven, so
// each month's lookup adds the US average since then (about 1,125 miles a
// month, 13,500 a year) rather than valuing a car at a reading that's
// getting older; telling Prism the real reading starts the count again.

import type { ManualItem } from "./manual";
import type { Cents, ISODate } from "./types";

export type VehicleValuation = {
  itemId: string;
  vin: string;
  /** The odometer reading the person gave, and the day they gave it; null for VinAudit's average for that vehicle. */
  mileage: { miles: number; on: ISODate } | null;
  /** A random uuid: what the lookup limit counts this vehicle by. */
  key: string;
  /** The last estimate's range and the day it was made. */
  estimate: { low: Cents; high: Cents; on: ISODate } | null;
};

export const VIN_LENGTH = 17;
export const MILES_MAX = 2_000_000;
/** What the average US vehicle is driven in a month. */
export const MILES_A_MONTH = 1_125;
const MAX_VEHICLES = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const cents = (x: unknown): x is Cents => Number.isSafeInteger(x) && (x as number) > 0 && (x as number) <= 1_000_000_000_000;

// Every vehicle sold in the US since 1981 carries a check digit in its ninth place: a VIN mistyped by one character almost never passes.
const LETTER_VALUES: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** A VIN as a person would copy it off a card: spaces and dashes dropped, capitals, 17 characters (never I, O or Q), and its check digit right. */
export function cleanVin(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const vin = x.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return null;
  const sum = [...vin].reduce((s, c, i) => s + (/\d/.test(c) ? Number(c) : LETTER_VALUES[c]!) * WEIGHTS[i]!, 0);
  const check = sum % 11 === 10 ? "X" : String(sum % 11);
  return vin[8] === check ? vin : null;
}

/** An odometer reading as typed ("48,250"): a whole number of miles, or null when it isn't one. */
export function cleanMiles(x: unknown): number | null {
  if (typeof x !== "string") return null;
  const s = x.replace(/[\s,]/g, "");
  if (!/^\d{1,7}$/.test(s)) return null;
  const n = Number(s);
  return n <= MILES_MAX ? n : null;
}

/** The miles to value it at today: the reading given, plus the average driven since, to the nearest hundred. */
export function milesToday(mileage: VehicleValuation["mileage"], today: ISODate): number | null {
  if (!mileage) return null;
  const days = Math.max(0, (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${mileage.on}T00:00:00Z`)) / 86_400_000);
  return Math.min(MILES_MAX, Math.round((mileage.miles + (days / 30.44) * MILES_A_MONTH) / 100) * 100);
}

/** What's stored, as valuations: each valid one survives on its own; never two for one vehicle. */
export function validVehicleValues(x: unknown): VehicleValuation[] {
  const list = (x as { v?: unknown; vehicles?: unknown } | null)?.v === 1 ? (x as { vehicles?: unknown }).vehicles : null;
  if (!Array.isArray(list)) return [];
  const out: VehicleValuation[] = [];
  const seen = new Set<string>();
  for (const raw of list.slice(0, MAX_VEHICLES)) {
    const r = raw as Partial<VehicleValuation> | null;
    const vin = cleanVin(r?.vin);
    const itemId = typeof r?.itemId === "string" && /^[a-z0-9-]{1,40}$/.test(r.itemId) ? r.itemId : null;
    const key = typeof r?.key === "string" && UUID.test(r.key) ? r.key : null;
    if (!vin || !itemId || !key || seen.has(itemId)) continue;
    const m = r?.mileage as VehicleValuation["mileage"] | undefined;
    const mileage = m && Number.isSafeInteger(m.miles) && m.miles >= 0 && m.miles <= MILES_MAX && typeof m.on === "string" && DATE.test(m.on) ? { miles: m.miles, on: m.on } : null;
    const e = r?.estimate as VehicleValuation["estimate"] | undefined;
    const estimate = e && cents(e.low) && cents(e.high) && e.low <= e.high && typeof e.on === "string" && DATE.test(e.on) ? { low: e.low, high: e.high, on: e.on } : null;
    seen.add(itemId);
    out.push({ itemId, vin, mileage, key, estimate });
  }
  return out;
}

/** What's stored: sealed by the caller. */
export function storedVehicleValues(vehicles: VehicleValuation[]) {
  return { v: 1 as const, vehicles };
}

/** A vehicle that's due this month's estimate: VinAudit keeps it, and nothing (the person's figure or an estimate) is this month's yet. */
export function vehicleValuationDue(item: ManualItem, valuation: VehicleValuation | undefined, month: string): boolean {
  return item.kind === "vehicle" && valuation !== undefined && !item.values.some((v) => v.month === month);
}
