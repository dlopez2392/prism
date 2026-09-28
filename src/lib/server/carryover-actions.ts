"use server";

// src/lib/server/carryover-actions.ts
//
// After signing in, whatever this browser held from before — a linked bank,
// Coinbase, budgets, goals — moves into the account only when the person says
// so. Asking first matters on a shared computer: signing in must never sweep
// someone else's bank into your account.
//
// The account's own data wins: device budgets or goals fill an account that
// has none, and never overwrite ones it already has. Once moved, the device
// copies are deleted, so nothing sensitive lingers in this browser.

import { cookies } from "next/headers";
import { coinbaseConfig, revokeToken } from "@/lib/coinbase/client";
import { plaidConfig } from "@/lib/plaid/client";
import { currentAccount } from "@/lib/supabase/server";
import { addAccountPlaidItem, loadAccount, saveAccountBudgets, saveAccountCoinbase, saveAccountGoals } from "./account-store";
import { COINBASE_COOKIE, isExpired, readLink } from "./coinbase-store";
import { BUDGETS_COOKIE, CARRYOVER_COOKIE, GOALS_COOKIE, readPlan } from "./plan-store";
import { open, VAULT_COOKIE, vaultKey } from "./vault";

export async function moveDeviceToAccount(): Promise<void> {
  const account = await currentAccount();
  if (!account) return;
  const jar = await cookies();
  let key: Buffer | null = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  const saved = await loadAccount(account, key);

  const device = readPlan(jar);
  if (device.budgets && !saved.plan.budgets) await saveAccountBudgets(account, device.budgets);
  if (device.goals && !saved.plan.goals) await saveAccountGoals(account, device.goals);

  if (key && plaidConfig()) {
    const vault = open(jar.get(VAULT_COOKIE)?.value, key);
    const have = new Set(saved.items.map((i) => i.itemId));
    for (const item of vault?.items ?? []) if (!have.has(item.itemId)) await addAccountPlaidItem(account, item, key);
  }

  const cb = coinbaseConfig();
  const link = cb && key ? readLink(jar.get(COINBASE_COOKIE)?.value, key) : null;
  if (cb && key && link) {
    if (!saved.coinbase) await saveAccountCoinbase(account, link, key);
    // The account already has its own Coinbase link: this one is redundant, so kill it at the source.
    else if (!isExpired(link)) await revokeToken(cb, link.accessToken).catch(() => undefined);
  }

  for (const name of [BUDGETS_COOKIE, GOALS_COOKIE, VAULT_COOKIE, COINBASE_COOKIE, CARRYOVER_COOKIE]) jar.delete(name);
}

/** "Not now": ask again in 30 days. The device data stays on the device, untouched. */
export async function carryoverLater(): Promise<void> {
  (await cookies()).set(CARRYOVER_COOKIE, "later", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}
