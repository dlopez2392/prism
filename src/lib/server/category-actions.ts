"use server";

// src/lib/server/category-actions.ts
//
// The Server Action behind "Change category" on a transaction. A fix belongs
// to the person's account (sealed, like the transactions it renames), so it
// needs a signed-in account; there is no device copy. Nothing from the
// browser is trusted: the category must be one Prism has, the ids and names
// are bounded, and the rule that money going out is never income is enforced
// again wherever fixes are applied (finance/category-rules.ts). Next checks
// the action's Origin against the host (CSRF).

import { refresh } from "next/cache";
import { categoryLabel } from "@/lib/finance/categories";
import { isCategoryId, withFix, type CategoryFix } from "@/lib/finance/category-rules";
import type { PlanFormState } from "@/lib/finance/plan";
import { currentAccount } from "@/lib/supabase/server";
import { loadAccountCategoryRules, saveAccountCategoryRules } from "./account-store";
import { vaultKey } from "./vault";

const TEXT_MAX = 200;

function text(form: FormData, name: string): string | null {
  const v = form.get(name);
  return typeof v === "string" && v.trim().length > 0 && v.length <= TEXT_MAX ? v.trim() : null;
}

function readFix(form: FormData): CategoryFix | null {
  const transactionId = text(form, "transactionId");
  const merchant = text(form, "merchant");
  if (!transactionId || !merchant) return null;
  if (form.get("intent") === "reset") return { kind: "reset", transactionId, merchant };
  const category = form.get("category");
  if (!isCategoryId(category)) return null;
  return { kind: "set", transactionId, merchant, category, everyAtMerchant: form.get("everyAtMerchant") === "on" };
}

export async function fixCategory(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const failed = (message: string): PlanFormState => ({ status: "error", message });
  const account = await currentAccount();
  if (!account) return failed("Sign in to fix categories. They're kept in your account.");
  let key = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  if (!key) return failed("Prism can't save that right now. Try again later.");
  const fix = readFix(form);
  if (!fix) return failed("Pick a category first.");

  try {
    const current = await loadAccountCategoryRules(account, key);
    await saveAccountCategoryRules(account, withFix(current, fix), key);
  } catch {
    return failed("That didn't save. Try again in a moment.");
  }
  refresh();
  const message =
    fix.kind === "reset"
      ? `${fix.merchant} is back to your bank's categories.`
      : fix.everyAtMerchant
        ? `Every purchase at ${fix.merchant} is now ${categoryLabel(fix.category)}.`
        : `That ${fix.merchant} purchase is now ${categoryLabel(fix.category)}.`;
  return { status: "saved", message, at: Date.now() };
}
