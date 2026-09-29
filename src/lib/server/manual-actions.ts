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

import { refresh } from "next/cache";
import { monthKey } from "@/lib/finance/dates";
import { cleanManualName, isManualKind, MANUAL_KINDS, MANUAL_VALUE_MAX, MAX_MANUAL_ITEMS, manualId, withValue, type ManualItem } from "@/lib/finance/manual";
import { parseDollars, type FieldErrors, type PlanFormState } from "@/lib/finance/plan";
import { currentAccount, type Account } from "@/lib/supabase/server";
import { loadAccountManualItems, saveAccountManualItems } from "./account-store";
import { requestToday } from "./finance";
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
  const raw = form.get("value");
  const value = typeof raw === "string" ? parseDollars(raw) : null;
  const errors: FieldErrors = {};
  if (!isManualKind(kind)) errors.kind = "Pick what this is.";
  if (!name) errors.name = "Give it a name, up to 40 characters.";
  if (value === null || value > MANUAL_VALUE_MAX) errors.value = "Enter an amount in dollars, like 350,000.";
  if (Object.keys(errors).length || !isManualKind(kind) || !name || value === null) return failed("Check the highlighted fields.", errors);

  let items: ManualItem[];
  try {
    items = await loadAccountManualItems(who.account, who.key);
  } catch {
    return failed("That didn't save. Try again in a moment.");
  }
  const month = monthKey(await requestToday());
  const id = form.get("id");
  const existing = typeof id === "string" && id ? items.find((i) => i.id === id) : undefined;
  if (typeof id === "string" && id && !existing) return failed("That item isn't there any more. Close this and try again.");
  if (!existing && items.length >= MAX_MANUAL_ITEMS) return failed(`You can add up to ${MAX_MANUAL_ITEMS} things. Remove one first.`);

  const next = existing
    ? items.map((i) => (i.id === existing.id ? withValue({ ...i, kind, name }, month, value) : i))
    : [...items, { id: manualId(name, items.map((i) => i.id)), kind, name, values: [{ month, value }] }];
  try {
    await saveAccountManualItems(who.account, next, who.key);
  } catch {
    return failed("That didn't save. Try again in a moment.");
  }
  refresh();
  const owed = MANUAL_KINDS[kind].owed;
  return { status: "saved", message: existing ? `${name} updated.` : `${name} added to your ${owed ? "debts" : "net worth"}.`, at: Date.now() };
}

export async function deleteManualItem(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const who = await owner();
  if ("status" in who) return who;
  const id = form.get("id");
  let items: ManualItem[];
  try {
    items = await loadAccountManualItems(who.account, who.key);
  } catch {
    return failed("That didn't remove. Try again in a moment.");
  }
  const gone = items.find((i) => i.id === id);
  if (!gone) return failed("That item isn't there any more.");
  try {
    await saveAccountManualItems(
      who.account,
      items.filter((i) => i.id !== gone.id),
      who.key,
    );
  } catch {
    return failed("That didn't remove. Try again in a moment.");
  }
  refresh();
  return { status: "saved", message: `${gone.name} removed.`, at: Date.now() };
}
