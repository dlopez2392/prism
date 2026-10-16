// src/lib/server/vehicle-values.ts
//
// Asking VinAudit what a vehicle is worth, only with the database's go-ahead
// (claim_vehicle_value_lookup: the cap across everyone, three vehicles a
// person, each vehicle once a month), and keeping the answer as that month's
// value, marked as an estimate. Used when a person saves a vehicle with no
// value typed, and on their visits, after the response, for vehicles due this
// month. The same shape as home-values.ts.

import "server-only";
import { monthKey } from "@/lib/finance/dates";
import { withValue } from "@/lib/finance/manual";
import type { ISODate } from "@/lib/finance/types";
import { milesToday, vehicleValuationDue, type VehicleValuation } from "@/lib/finance/vehicle-value";
import { estimateVehicleValue, VehicleValueError, vehicleValuesEnabled, type VehicleEstimate } from "@/lib/carvalue/vinaudit";
import type { Account } from "@/lib/supabase/server";
import { loadAccountHomeValues, loadAccountManualItems, loadAccountVehicleValues, saveAccountManualItemsAndHomes } from "./account-store";
import type { VaultKey } from "./vault";
import { msg } from "@/lib/i18n/t";

type Env = Record<string, string | undefined>;

/** Why there's no estimate: the database said no, or VinAudit couldn't answer. */
export type NoVehicleEstimate = "already" | "person-limit" | "limit" | "refused" | "error" | VehicleValueError["reason"];

const ANSWERS = new Set(["ok", "already", "person-limit", "limit", "refused"]);

/** The database's go-ahead for one lookup. It counts the request, so it's asked only right before one. */
async function claim(account: Account, vehicleKey: string): Promise<"ok" | NoVehicleEstimate> {
  const { data, error } = await account.supabase.rpc("claim_vehicle_value_lookup", { p_vehicle_key: vehicleKey });
  if (error || typeof data !== "string" || !ANSWERS.has(data)) return "error";
  return data as "ok" | NoVehicleEstimate;
}

/** Claim, then ask. A claim is spent even when VinAudit can't answer: the cap counts requests, not answers. */
export async function lookUpVehicleValue(
  account: Account,
  vehicle: Pick<VehicleValuation, "vin" | "mileage" | "key">,
  today: ISODate,
  env: Env = process.env,
  fetchImpl?: typeof fetch,
): Promise<{ ok: true; estimate: VehicleEstimate } | { ok: false; why: NoVehicleEstimate }> {
  if (!vehicleValuesEnabled(env)) return { ok: false, why: "refused" };
  const go = await claim(account, vehicle.key);
  if (go !== "ok") return { ok: false, why: go };
  try {
    return { ok: true, estimate: await estimateVehicleValue(vehicle.vin, milesToday(vehicle.mileage, today), env, fetchImpl) };
  } catch (e) {
    return { ok: false, why: e instanceof VehicleValueError ? e.reason : "unavailable" };
  }
}

/** Why there's no estimate, in English; the screen says it in the person's language (`t(…)`). */
export function noVehicleEstimateMessage(why: NoVehicleEstimate): string {
  switch (why) {
    case "already":
      return msg("VinAudit already estimated it this month. The next estimate comes next month.");
    case "person-limit":
      return msg("Prism estimates up to three vehicles a month for you. Enter this one's value yourself for now.");
    case "limit":
      return msg("Prism's vehicle estimates are used up for now. Enter a value yourself; VinAudit takes over again next month.");
    case "refused":
      return msg("Finish signing in, including your authenticator, and try again.");
    case "not-found":
      return msg("VinAudit doesn't have enough sales of that vehicle to value it. Check the VIN, or enter a value yourself.");
    default:
      return msg("VinAudit didn't answer. Enter a value for now; Prism tries again next month.");
  }
}

/**
 * On a visit, after the response: each vehicle due this month, one at a
 * time, each answer saved over a fresh read. A value the person typed
 * meanwhile stays theirs; a vehicle removed or changed meanwhile gets nothing.
 */
export async function refreshDueVehicleValues(account: Account, key: VaultKey, today: ISODate, env: Env = process.env, fetchImpl?: typeof fetch): Promise<number> {
  if (!vehicleValuesEnabled(env)) return 0;
  const month = monthKey(today);
  const [items, vehicles] = await Promise.all([loadAccountManualItems(account, key), loadAccountVehicleValues(account, key)]);
  const due = vehicles.filter((v) => {
    const item = items.find((i) => i.id === v.itemId);
    return item !== undefined && vehicleValuationDue(item, v, month);
  });
  let saved = 0;
  for (const vehicle of due) {
    const r = await lookUpVehicleValue(account, vehicle, today, env, fetchImpl);
    if (!r.ok) continue;
    const [nowItems, nowHomes, nowVehicles] = await Promise.all([loadAccountManualItems(account, key), loadAccountHomeValues(account, key), loadAccountVehicleValues(account, key)]);
    const item = nowItems.find((i) => i.id === vehicle.itemId && i.kind === "vehicle");
    const still = nowVehicles.find((v) => v.itemId === vehicle.itemId && v.key === vehicle.key);
    if (!item || !still) continue;
    const typed = item.values.some((v) => v.month === month && !v.estimated);
    await saveAccountManualItemsAndHomes(
      account,
      typed ? nowItems : nowItems.map((i) => (i === item ? withValue(i, month, r.estimate.value, true) : i)),
      nowHomes,
      key,
      nowVehicles.map((v) => (v === still ? { ...v, estimate: { low: r.estimate.low, high: r.estimate.high, on: today } } : v)),
    );
    saved++;
  }
  return saved;
}
