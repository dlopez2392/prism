"use server";

// src/lib/server/details-actions.ts
//
// Keeping what a person adds to their own transactions (finance/details.ts):
// a split, their tags, who owes them. Only for a signed-in account, only on
// one of their OWN lines as the bank sent it (a split's parts are joined back
// first), and only what checkDetail allows: parts that add up exactly, an
// amount owed no larger than what was paid. Sealed in their account, never on
// a device and never shown to a household. Next checks the action's Origin
// against the host (CSRF).

import { refresh } from "next/cache";
import { checkDetail, withDetail, wholeLines } from "@/lib/finance/details";
import { currentAccount } from "@/lib/supabase/server";
import { loadAccountDetails, saveAccountDetails } from "./account-store";
import { getPersonalFinance } from "./finance";
import { vaultKey } from "./vault";

export type DetailState = { status: "idle" } | { status: "saved"; message: string; at: number } | { status: "error"; message: string };

function safeKey() {
  try {
    return vaultKey();
  } catch {
    return null;
  }
}

/** The person's own line, whole, by the id the bank gave it; or why there isn't one to change. */
async function ownLine(txnId: unknown) {
  const account = await currentAccount();
  if (!account) return { ok: false, error: "Sign in to keep these. They're kept in your account." } as const;
  const key = safeKey();
  if (!key) return { ok: false, error: "Prism can't save that right now. Try again later." } as const;
  if (typeof txnId !== "string" || !txnId || txnId.length > 200) return { ok: false, error: "That transaction isn't one of yours." } as const;
  const data = await getPersonalFinance();
  if (data.source === "demo") return { ok: false, error: "Link a bank first. Splits and tags go on your own transactions." } as const;
  const line = wholeLines(data.transactions).find((t) => t.id === txnId && !t.pending);
  if (!line) return { ok: false, error: "That transaction isn't one of yours, or it's still pending." } as const;
  return { ok: true, account, key, line, today: data.today } as const;
}

/** Set (or clear) a line's split, tags and who owes for it, all at once, as the dialog shows them. */
export async function saveTransactionDetail(txnId: unknown, detail: unknown): Promise<DetailState> {
  try {
    const own = await ownLine(txnId);
    if (!own.ok) return { status: "error", message: own.error };
    const checked = checkDetail(own.line, detail);
    if ("error" in checked) return { status: "error", message: checked.error };
    const current = await loadAccountDetails(own.account, own.key);
    // Paid back stays paid back: the dialog never sends the day, so keep the one already recorded.
    const was = current.lines[own.line.id]?.owed;
    const kept = checked.detail?.owed && was?.paid && was.who === checked.detail.owed.who && was.amount === checked.detail.owed.amount ? { ...checked.detail, owed: { ...checked.detail.owed, paid: was.paid } } : checked.detail;
    await saveAccountDetails(own.account, withDetail(current, own.line.id, kept), own.key);
    refresh();
    const message = !kept ? "Back to how the bank sent it." : kept.split ? `Split into ${kept.split.length} parts. Every total now counts them that way.` : "Saved.";
    return { status: "saved", message, at: Date.now() };
  } catch {
    return { status: "error", message: "That didn't save. Try again in a moment." };
  }
}

/** Mark what someone owed as paid back (or open again): the rest of the line stays as it is. */
export async function markOwedPaid(txnId: unknown, paid: unknown): Promise<DetailState> {
  try {
    const own = await ownLine(txnId);
    if (!own.ok) return { status: "error", message: own.error };
    const current = await loadAccountDetails(own.account, own.key);
    const detail = current.lines[own.line.id];
    if (!detail?.owed) return { status: "error", message: "Nobody owes you for that one." };
    const next = { ...detail, owed: { ...detail.owed, paid: paid === true ? own.today : null } };
    await saveAccountDetails(own.account, withDetail(current, own.line.id, next), own.key);
    refresh();
    return { status: "saved", message: paid === true ? `Marked paid back by ${detail.owed.who}.` : `Open again: ${detail.owed.who} still owes you.`, at: Date.now() };
  } catch {
    return { status: "error", message: "That didn't save. Try again in a moment." };
  }
}
