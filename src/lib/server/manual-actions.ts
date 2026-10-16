"use server";

// src/lib/server/manual-actions.ts
//
// The Server Actions behind "Add something you own or owe" on Net worth.
// What someone adds belongs to their account (sealed, like everything else
// Prism keeps about money), so these need a signed-in account; there is no
// device copy. Each re-reads the stored items strictly, so a failed read can
// never write over them, and nothing from the browser is trusted: the kind,
// the name and the amount are each re-validated here. Next checks each
// action's Origin against the host (CSRF).
//
// A home can have its value kept up to date by RentCast (when the operator has
// switched it on): the person ticks it and gives the address, which is kept
// sealed apart from the items (finance/home-value.ts). Left blank, the value is
// RentCast's estimate, asked for here with the database's go-ahead
// (home-values.ts); typed, the value is theirs for this month.
//
// A vehicle can have its value kept up to date by VinAudit the same way
// (vehicle-values.ts): the person gives its VIN and, if they like, its
// mileage, sealed apart from the items (finance/vehicle-value.ts). Its name
// may be left blank then: VinAudit's name for it ("2019 Honda Civic LX") is
// used.

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { monthKey } from "@/lib/finance/dates";
import { cleanAddress, type HomeValuation } from "@/lib/finance/home-value";
import { cleanMiles, cleanVin, type VehicleValuation } from "@/lib/finance/vehicle-value";
import { vehicleValuesEnabled } from "@/lib/carvalue/vinaudit";
import { cleanManualName, isManualKind, MANUAL_KINDS, MANUAL_VALUE_MAX, MAX_MANUAL_ITEMS, manualId, withValue, type ManualItem } from "@/lib/finance/manual";
import { money0 } from "@/lib/finance/format";
import { parseDollars, type FieldErrors, type PlanFormState } from "@/lib/finance/plan";
import { homeValuesEnabled } from "@/lib/homevalue/rentcast";
import { plusNeeds } from "@/lib/billing/plans";
import { plusFor } from "@/lib/billing/plus";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/t";
import { currentAccount, type Account } from "@/lib/supabase/server";
import { loadAccountHomeValues, loadAccountManualItems, loadAccountVehicleValues, saveAccountManualItemsAndHomes } from "./account-store";
import { requestToday } from "./finance";
import { lookUpHomeValue, noEstimateMessage } from "./home-values";
import { lookUpVehicleValue, noVehicleEstimateMessage } from "./vehicle-values";
import { vaultKey, type VaultKey } from "./vault";

const failed = (message: string, fields?: FieldErrors): PlanFormState => ({ status: "error", message, fields });

/** The signed-in account and the key its items are sealed with, or the reason there's neither. */
async function owner(t: T): Promise<{ account: Account; key: VaultKey } | PlanFormState> {
  const account = await currentAccount();
  if (!account) return failed(t("Sign in to add what you own or owe. It's kept in your account."));
  let key: VaultKey | null = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  if (!key) return failed(t("Prism can't save that right now. Try again later."));
  return { account, key };
}

export async function saveManualItem(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const t = await getT();
  const who = await owner(t);
  if ("status" in who) return who;
  const kind = form.get("kind");
  const typedName = form.get("name");
  const nameBlank = typeof typedName !== "string" || typedName.trim() === "";
  let name = cleanManualName(typedName);
  // Only a home or a vehicle, only when it's switched on, and only when the person ticked it.
  const estimating = kind === "home" && form.get("estimate") === "on" && homeValuesEnabled();
  const carEstimating = kind === "vehicle" && form.get("estimate") === "on" && vehicleValuesEnabled();
  const address = estimating ? cleanAddress(form.get("address")) : null;
  const vin = carEstimating ? cleanVin(form.get("vin")) : null;
  const rawMiles = form.get("miles");
  const milesBlank = typeof rawMiles !== "string" || rawMiles.trim() === "";
  const miles = carEstimating && !milesBlank ? cleanMiles(rawMiles) : null;
  const raw = form.get("value");
  const blank = typeof raw !== "string" || raw.trim() === "";
  const value = blank ? null : parseDollars(raw as string);
  const errors: FieldErrors = {};
  if (!isManualKind(kind)) errors.kind = t("Pick what this is.");
  // A vehicle VinAudit values may be left unnamed: its name comes from VinAudit.
  if (!name && !(carEstimating && nameBlank)) errors.name = t("Give it a name, up to 40 characters.");
  if (estimating && !address) errors.address = t("Enter the street address, city, state and ZIP code.");
  if (carEstimating && !vin) errors.vin = t("Enter the 17-character VIN from your registration or insurance card.");
  if (carEstimating && !milesBlank && miles === null) errors.miles = t("Enter the miles on the odometer, like 48,250.");
  // Blank is allowed only when RentCast or VinAudit is to fill it.
  if ((blank && !estimating && !carEstimating) || (!blank && (value === null || value > MANUAL_VALUE_MAX))) errors.value = t("Enter an amount in dollars, like 350,000.");
  if (Object.keys(errors).length || !isManualKind(kind)) return failed(t("Check the highlighted fields."), errors);

  let items: ManualItem[];
  let homes: HomeValuation[];
  let vehicles: VehicleValuation[];
  try {
    [items, homes, vehicles] = await Promise.all([loadAccountManualItems(who.account, who.key), loadAccountHomeValues(who.account, who.key), loadAccountVehicleValues(who.account, who.key)]);
  } catch {
    return failed(t("That didn't save. Try again in a moment."));
  }
  const today = await requestToday();
  const month = monthKey(today);
  const id = form.get("id");
  const existing = typeof id === "string" && id ? items.find((i) => i.id === id) : undefined;
  if (typeof id === "string" && id && !existing) return failed(t("That item isn't there any more. Close this and try again."));
  if (!existing && items.length >= MAX_MANUAL_ITEMS) return failed(t("You can add up to {n} things. Remove one first.", { n: MAX_MANUAL_ITEMS }));

  // An unnamed vehicle is named once VinAudit answers; until then it goes by its kind.
  const itemId = existing?.id ?? manualId(name ?? "vehicle", items.map((i) => i.id));
  let item: ManualItem = existing ? { ...existing, kind, name: name ?? existing.name } : { id: itemId, kind, name: name ?? "", values: [] };
  if (value !== null) item = withValue(item, month, value);

  // The home's address: a new one gets a new key, so moving house is a new home to the lookup limit.
  const prior = homes.find((h) => h.itemId === itemId);
  let home: HomeValuation | null = estimating && address ? (prior && prior.address === address ? prior : { itemId, address, key: randomUUID(), estimate: null }) : null;
  // Keeping a home's value up to date is part of Prism Plus. A home already kept up to date stays set up, so it carries on once Plus is back.
  const plus = home ? (await plusFor(who.account)).plus : true;
  if (home && !plus && (!prior || prior.address !== home.address)) return failed(plusNeeds("home-values", t), { address: plusNeeds("home-values", t) });
  if (home && !plus && value === null && item.values.length === 0) return failed(t("Check the highlighted fields."), { value: t("Enter what it's worth today, for now.") });
  let note: string | null = null;
  if (home && plus && value === null && !item.values.some((v) => v.month === month && v.estimated)) {
    const r = await lookUpHomeValue(who.account, home);
    if (r.ok) {
      item = withValue(item, month, r.estimate.value, true);
      home = { ...home, estimate: { low: r.estimate.low, high: r.estimate.high, on: today } };
      note = t("RentCast estimates {amount} (between {low} and {high}).", { amount: money0(r.estimate.value), low: money0(r.estimate.low), high: money0(r.estimate.high) });
    } else if (item.values.length === 0) {
      // Nothing to show for it yet: the person's own figure, for now.
      // Why there's no estimate is home-values.ts's to say; t() finds its Spanish once it's marked there.
      return failed(t(noEstimateMessage(r.why)), { value: t("Enter what it's worth today, for now.") });
    } else {
      note = `${t(noEstimateMessage(r.why))} ${t("Its last value stays.")}`;
    }
  }

  // The vehicle's VIN: a new one gets a new key, so a new car is a new vehicle to the lookup limit. The mileage is dated the day it's given.
  const priorCar = vehicles.find((v) => v.itemId === itemId);
  const mileage = miles === null ? null : priorCar?.mileage?.miles === miles ? priorCar.mileage : { miles, on: today };
  let car: VehicleValuation | null = carEstimating && vin ? (priorCar && priorCar.vin === vin ? { ...priorCar, mileage } : { itemId, vin, mileage, key: randomUUID(), estimate: null }) : null;
  const carPlus = car ? (await plusFor(who.account)).plus : true;
  if (car && !carPlus && (!priorCar || priorCar.vin !== car.vin)) return failed(plusNeeds("vehicle-values", t), { vin: plusNeeds("vehicle-values", t) });
  if (car && !carPlus && value === null && item.values.length === 0) return failed(t("Check the highlighted fields."), { value: t("Enter what it's worth today, for now.") });
  if (car && carPlus && value === null && !item.values.some((v) => v.month === month && v.estimated)) {
    const r = await lookUpVehicleValue(who.account, car, today);
    if (r.ok) {
      item = withValue(item, month, r.estimate.value, true);
      if (!item.name) item = { ...item, name: cleanManualName(r.estimate.vehicle) ?? "" };
      car = { ...car, estimate: { low: r.estimate.low, high: r.estimate.high, on: today } };
      note = t("VinAudit estimates {amount} (between {low} and {high}).", { amount: money0(r.estimate.value), low: money0(r.estimate.low), high: money0(r.estimate.high) });
    } else if (item.values.length === 0) {
      return failed(t(noVehicleEstimateMessage(r.why)), { value: t("Enter what it's worth today, for now.") });
    } else {
      note = `${t(noVehicleEstimateMessage(r.why))} ${t("Its last value stays.")}`;
    }
  }
  if (!item.name) return failed(t("Check the highlighted fields."), { name: t("Give it a name, up to 40 characters.") });
  name = item.name;

  const next = existing ? items.map((i) => (i.id === existing.id ? item : i)) : [...items, item];
  const nextHomes = [...homes.filter((h) => h.itemId !== itemId), ...(home ? [home] : [])];
  const nextVehicles = [...vehicles.filter((v) => v.itemId !== itemId), ...(car ? [car] : [])];
  try {
    await saveAccountManualItemsAndHomes(who.account, next, nextHomes, who.key, nextVehicles);
  } catch {
    return failed(t("That didn't save. Try again in a moment."));
  }
  refresh();
  const owed = MANUAL_KINDS[kind].owed;
  const saved = existing ? t("{name} updated.", { name }) : owed ? t("{name} added to your debts.", { name }) : t("{name} added to your net worth.", { name });
  return { status: "saved", message: note ? `${saved} ${note}` : saved, at: Date.now() };
}

export async function deleteManualItem(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const t = await getT();
  const who = await owner(t);
  if ("status" in who) return who;
  const id = form.get("id");
  let items: ManualItem[];
  let homes: HomeValuation[];
  let vehicles: VehicleValuation[];
  try {
    [items, homes, vehicles] = await Promise.all([loadAccountManualItems(who.account, who.key), loadAccountHomeValues(who.account, who.key), loadAccountVehicleValues(who.account, who.key)]);
  } catch {
    return failed(t("That didn't remove. Try again in a moment."));
  }
  const gone = items.find((i) => i.id === id);
  if (!gone) return failed(t("That item isn't there any more."));
  try {
    // Its address or VIN goes with it.
    await saveAccountManualItemsAndHomes(
      who.account,
      items.filter((i) => i.id !== gone.id),
      homes.filter((h) => h.itemId !== gone.id),
      who.key,
      vehicles.filter((v) => v.itemId !== gone.id),
    );
  } catch {
    return failed(t("That didn't remove. Try again in a moment."));
  }
  refresh();
  return { status: "saved", message: t("{name} removed.", { name: gone.name }), at: Date.now() };
}
