"use server";

// src/lib/server/return-actions.ts
//
// The figures from a person's filed return (finance/tax-return.ts): keep the
// ones they checked, one return per tax year, or remove one. The PDF never
// reaches here: it's read in the browser and only the figures are sent, and
// every one is checked again. Sealed with the rest of their details
// (profiles.sealed_txn_details), only for a signed-in account with money of
// their own, never shown to a household, and part of Prism Plus with the tax
// year. Removing comes back with what Undo needs. Next checks each action's
// Origin against the host (CSRF).

import { refresh } from "next/cache";
import { plusNeeds } from "@/lib/billing/plans";
import { plusFor } from "@/lib/billing/plus";
import { withTaxReturn } from "@/lib/finance/details";
import { validTaxReturn, type TaxReturn } from "@/lib/finance/tax-return";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/t";
import { currentAccount } from "@/lib/supabase/server";
import { loadAccountDetails, saveAccountDetails } from "./account-store";
import { getPersonalFinance } from "./finance";
import { vaultKey } from "./vault";

export type ReturnState = { status: "saved"; message: string; at: number; undo?: TaxReturn | null } | { status: "error"; message: string };

/** The signed-in person on Prism Plus, the key their details are sealed with, and today; or why not. */
async function own() {
  const account = await currentAccount();
  if (!account) return { ok: false, error: msg("Sign in to keep these. They're kept in your account.") } as const;
  if (!(await plusFor(account)).plus) return { ok: false, plus: true } as const;
  let key = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  if (!key) return { ok: false, error: msg("Prism can't save that right now. Try again later.") } as const;
  const data = await getPersonalFinance();
  if (data.source === "demo") return { ok: false, error: msg("Link a bank or import your history first: your return sits beside your own money.") } as const;
  return { ok: true, account, key, today: data.today } as const;
}

/** Keep a return's figures, replacing any kept for the same tax year. */
export async function saveTaxReturn(input: unknown): Promise<ReturnState> {
  const t = await getT();
  try {
    const me = await own();
    if (!me.ok) return { status: "error", message: "plus" in me ? plusNeeds("taxes", t) : t(me.error) };
    const r = validTaxReturn(input, Number(me.today.slice(0, 4)));
    if (!r) return { status: "error", message: t("Check the year and the figures, and add at least your adjusted gross income or your total tax.") };
    const current = await loadAccountDetails(me.account, me.key);
    await saveAccountDetails(me.account, withTaxReturn(current, r.year, r), me.key);
    refresh();
    return { status: "saved", message: t("Your {year} return is saved. It's on Taxes beside this year's money.", { year: r.year }), at: Date.now() };
  } catch {
    return { status: "error", message: t("That didn't save. Try again in a moment.") };
  }
}

/** Remove the return kept for a tax year; what comes back puts it back. */
export async function removeTaxReturn(year: unknown): Promise<ReturnState> {
  const t = await getT();
  try {
    if (!Number.isSafeInteger(year)) return { status: "error", message: t("That didn't come through. Try again.") };
    const me = await own();
    if (!me.ok) return { status: "error", message: "plus" in me ? plusNeeds("taxes", t) : t(me.error) };
    const current = await loadAccountDetails(me.account, me.key);
    const old = current.returns?.[String(year)] ?? null;
    if (!old) return { status: "error", message: t("There's no {year} return to remove.", { year: year as number }) };
    await saveAccountDetails(me.account, withTaxReturn(current, year as number, null), me.key);
    refresh();
    return { status: "saved", message: t("Your {year} return is removed.", { year: year as number }), at: Date.now(), undo: old };
  } catch {
    return { status: "error", message: t("That didn't save. Try again in a moment.") };
  }
}
