"use server";

// src/lib/server/orders-actions.ts
//
// Keeping what Amazon charges paid for (finance/orders.ts). The order history
// never leaves the person's browser: only its matches arrive here, a batch at
// a time, and none is trusted. Each must name one of the person's OWN Amazon
// lines, dated after the order, whose items add up to exactly the bank's
// amount (validOrderMatch); the rest are dropped and counted, never kept.
// What's kept is sealed in their account, never on a device and never shown
// to a household. Next checks the action's Origin against the host (CSRF).

import { refresh } from "next/cache";
import { mergeOrderNotes, NO_ORDER_NOTES, ORDER_LIMITS, validOrderMatch, type OrderNote } from "@/lib/finance/orders";
import { currentAccount } from "@/lib/supabase/server";
import { loadAccountOrderNotes, saveAccountOrderNotes } from "./account-store";
import { getPersonalFinance } from "./finance";
import { vaultKey } from "./vault";

export type OrderSaveState = { status: "idle" } | { status: "saved"; message: string; saved: number; dropped: number; at: number } | { status: "error"; message: string };

function safeKey() {
  try {
    return vaultKey();
  } catch {
    return null;
  }
}

/** One batch of matches: checked against the person's own lines, added to what's kept, and counted. The page says what it all came to. */
export async function saveOrderMatches(matches: unknown): Promise<OrderSaveState> {
  const failed = (message: string): OrderSaveState => ({ status: "error", message });
  const account = await currentAccount();
  if (!account) return failed("Sign in to keep these. They're kept in your account.");
  const key = safeKey();
  if (!key) return failed("Prism can't save that right now. Try again later.");
  if (!Array.isArray(matches) || matches.length === 0) return failed("There's nothing to keep yet. Choose a file first.");
  if (matches.length > ORDER_LIMITS.batch) return failed("That's too many at once. Choose the file again and Prism sends it in smaller parts.");

  try {
    const data = await getPersonalFinance();
    // Orders go on the person's own bank lines; the example household has none of theirs.
    if (data.source === "demo") return failed("Link the card you pay Amazon with first. Orders go on its own lines.");
    const byId = new Map(data.transactions.map((t) => [t.id, t]));
    const valid: [string, OrderNote][] = [];
    for (const m of matches) {
      const ok = validOrderMatch(m, byId);
      if (ok) valid.push(ok);
    }
    const dropped = matches.length - valid.length;
    if (valid.length === 0) return { status: "saved", message: "", saved: 0, dropped, at: Date.now() };
    const current = await loadAccountOrderNotes(account, key);
    await saveAccountOrderNotes(account, mergeOrderNotes(current, valid), key);
    refresh();
    return { status: "saved", message: "", saved: valid.length, dropped, at: Date.now() };
  } catch {
    return failed("That didn't save. Try again in a moment.");
  }
}

/** Forget every order. Nothing else changes, and adding the file again brings them back. */
export async function removeOrderNotes(): Promise<OrderSaveState> {
  const account = await currentAccount();
  if (!account) return { status: "error", message: "Sign in first." };
  const key = safeKey();
  if (!key) return { status: "error", message: "Prism can't do that right now. Try again later." };
  try {
    await saveAccountOrderNotes(account, NO_ORDER_NOTES, key);
  } catch {
    return { status: "error", message: "That didn't work. Try again in a moment." };
  }
  refresh();
  return { status: "saved", message: "Your Amazon orders are gone. Add the file again any time to bring them back.", saved: 0, dropped: 0, at: Date.now() };
}
