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

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { monthKey } from "@/lib/finance/dates";
import { cleanAddress, type HomeValuation } from "@/lib/finance/home-value";
import { cleanManualName, isManualKind, MANUAL_KINDS, MANUAL_VALUE_MAX, MAX_MANUAL_ITEMS, manualId, withValue, type ManualItem } from "@/lib/finance/manual";
import { money0 } from "@/lib/finance/format";
import { parseDollars, type FieldErrors, type PlanFormState } from "@/lib/finance/plan";
import { homeValuesEnabled } from "@/lib/homevalue/rentcast";
import { currentAccount, type Account } from "@/lib/supabase/server";
import { loadAccountHomeValues, loadAccountManualItems, saveAccountManualItemsAndHomes } from "./account-store";
import { requestToday } from "./finance";
import { lookUpHomeValue, noEstimateMessage } from "./home-values";
import { vaultKey, type VaultKey } from "./vault";

const failed = (message: string, fields?: FieldErrors): PlanFormState => ({ status: "error", message, fields });

/** The signed-in account and the key its items are sealed with, or the reason there's neither. */
async function owner(): Promise<{ account: Account; key: VaultKey } | PlanFormState> {
  const account = await currentAccount();
  if (!account) return failed("Sign in to add what you own or owe. It's kept in your account.");
  let key: VaultKey | null = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  if (!key) return failed("Prism can't save that right now. Try again later.");
  return { account, key };
}

export async function saveManualItem(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const who = await owner();
  if ("status" in who) return who;
  const kind = form.get("kind");
  const name = cleanManualName(form.get("name"));
  // Only a home, only when it's switched on, and only when the person ticked it.
  const estimating = kind === "home" && form.get("estimate") === "on" && homeValuesEnabled();
  const address = estimating ? cleanAddress(form.get("address")) : null;
  const raw = form.get("value");
  const blank = typeof raw !== "string" || raw.trim() === "";
  const value = blank ? null : parseDollars(raw as string);
  const errors: FieldErrors = {};
  if (!isManualKind(kind)) errors.kind = "Pick what this is.";
  if (!name) errors.name = "Give it a name, up to 40 characters.";
  if (estimating && !address) errors.address = "Enter the street address, city, state and ZIP code.";
  // Blank is allowed only when RentCast is to fill it.
  if ((blank && !estimating) || (!blank && (value === null || value > MANUAL_VALUE_MAX))) errors.value = "Enter an amount in dollars, like 350,000.";
  if (Object.keys(errors).length || !isManualKind(kind) || !name) return failed("Check the highlighted fields.", errors);

  let items: ManualItem[];
  let homes: HomeValuation[];
  try {
    [items, homes] = await Promise.all([loadAccountManualItems(who.account, who.key), loadAccountHomeValues(who.account, who.key)]);
  } catch {
    return failed("That didn't save. Try again in a moment.");
  }
  const today = await requestToday();
  const month = monthKey(today);
  const id = form.get("id");
  const existing = typeof id === "string" && id ? items.find((i) => i.id === id) : undefined;
  if (typeof id === "string" && id && !existing) return failed("That item isn't there any more. Close this and try again.");
  if (!existing && items.length >= MAX_MANUAL_ITEMS) return failed(`You can add up to ${MAX_MANUAL_ITEMS} things. Remove one first.`);

  const itemId = existing?.id ?? manualId(name, items.map((i) => i.id));
  let item: ManualItem = existing ? { ...existing, kind, name } : { id: itemId, kind, name, values: [] };
  if (value !== null) item = withValue(item, month, value);

  // The home's address: a new one gets a new key, so moving house is a new home to the lookup limit.
  const prior = homes.find((h) => h.itemId === itemId);
  let home: HomeValuation | null = estimating && address ? (prior && prior.address === address ? prior : { itemId, address, key: randomUUID(), estimate: null }) : null;
  let note: string | null = null;
  if (home && value === null && !item.values.some((v) => v.month === month && v.estimated)) {
    const r = await lookUpHomeValue(who.account, home);
    if (r.ok) {
      item = withValue(item, month, r.estimate.value, true);
      home = { ...home, estimate: { low: r.estimate.low, high: r.estimate.high, on: today } };
      note = `RentCast estimates ${money0(r.estimate.value)} (between ${money0(r.estimate.low)} and ${money0(r.estimate.high)}).`;
    } else if (item.values.length === 0) {
      // Nothing to show for it yet: the person's own figure, for now.
      return failed(noEstimateMessage(r.why), { value: "Enter what it's worth today, for now." });
    } else {
      note = `${noEstimateMessage(r.why)} Its last value stays.`;
    }
  }

  const next = existing ? items.map((i) => (i.id === existing.id ? item : i)) : [...items, item];
  const nextHomes = [...homes.filter((h) => h.itemId !== itemId), ...(home ? [home] : [])];
  try {
    await saveAccountManualItemsAndHomes(who.account, next, nextHomes, who.key);
  } catch {
    return failed("That didn't save. Try again in a moment.");
  }
  refresh();
  const owed = MANUAL_KINDS[kind].owed;
  const saved = existing ? `${name} updated.` : `${name} added to your ${owed ? "debts" : "net worth"}.`;
  return { status: "saved", message: note ? `${saved} ${note}` : saved, at: Date.now() };
}

export async function deleteManualItem(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const who = await owner();
  if ("status" in who) return who;
  const id = form.get("id");
  let items: ManualItem[];
  let homes: HomeValuation[];
  try {
    [items, homes] = await Promise.all([loadAccountManualItems(who.account, who.key), loadAccountHomeValues(who.account, who.key)]);
  } catch {
    return failed("That didn't remove. Try again in a moment.");
  }
  const gone = items.find((i) => i.id === id);
  if (!gone) return failed("That item isn't there any more.");
  try {
    // Its address goes with it.
    await saveAccountManualItemsAndHomes(
      who.account,
      items.filter((i) => i.id !== gone.id),
      homes.filter((h) => h.itemId !== gone.id),
      who.key,
    );
  } catch {
    return failed("That didn't remove. Try again in a moment.");
  }
  refresh();
  return { status: "saved", message: `${gone.name} removed.`, at: Date.now() };
}
