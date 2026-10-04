"use server";

// src/lib/server/p2p-actions.ts
//
// Keeping who Venmo, PayPal and Cash App payments were for (finance/p2p.ts).
// The file never leaves the person's browser: only its matches arrive here,
// and none is trusted. Each must name one of the person's OWN bank lines from
// that app, dated in the window after the payment, going the right way
// (validP2pMatch); the rest are dropped and counted, never kept. What's kept
// is sealed in their account, never on a device and never shown to a
// household. Next checks the action's Origin against the host (CSRF).

import { refresh } from "next/cache";
import { mergeP2pNotes, NO_P2P_NOTES, P2P_LIMITS, validP2pMatch, type P2pNote } from "@/lib/finance/p2p";
import { currentAccount } from "@/lib/supabase/server";
import { loadAccountP2pNotes, saveAccountP2pNotes } from "./account-store";
import { getPersonalFinance } from "./finance";
import { vaultKey } from "./vault";

export type P2pSaveState = { status: "idle" } | { status: "saved"; message: string; saved: number; at: number } | { status: "error"; message: string };

function safeKey() {
  try {
    return vaultKey();
  } catch {
    return null;
  }
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export async function saveP2pMatches(matches: unknown): Promise<P2pSaveState> {
  const failed = (message: string): P2pSaveState => ({ status: "error", message });
  const account = await currentAccount();
  if (!account) return failed("Sign in to keep these. They're kept in your account.");
  const key = safeKey();
  if (!key) return failed("Prism can't save that right now. Try again later.");
  if (!Array.isArray(matches) || matches.length === 0) return failed("There's nothing to keep yet. Choose a file first.");
  if (matches.length > P2P_LIMITS.notes) return failed(`That's more than ${P2P_LIMITS.notes.toLocaleString("en-US")} payments at once. Choose a shorter stretch of time.`);

  try {
    const data = await getPersonalFinance();
    // Notes go on the person's own bank lines; the example household has none of theirs.
    if (data.source === "demo") return failed("Link the bank your payments come from first. Notes go on its own lines.");
    const byId = new Map(data.transactions.map((t) => [t.id, t]));
    const valid: [string, P2pNote][] = [];
    for (const m of matches) {
      const ok = validP2pMatch(m, byId);
      if (ok) valid.push(ok);
    }
    if (valid.length === 0) return failed("None of those payments match a line in your accounts. Check the right bank is linked.");
    const current = await loadAccountP2pNotes(account, key);
    await saveAccountP2pNotes(account, mergeP2pNotes(current, valid), key);
    refresh();
    const dropped = matches.length - valid.length;
    const message = `${plural(valid.length, "payment now says who it was for.", "payments now say who each was for.")}${dropped ? ` ${dropped.toLocaleString("en-US")} no longer matched your accounts, so ${dropped === 1 ? "it was" : "they were"} left out.` : ""}`;
    return { status: "saved", message, saved: valid.length, at: Date.now() };
  } catch {
    return failed("That didn't save. Try again in a moment.");
  }
}

/** Forget every note. Nothing else changes, and adding the files again brings them back. */
export async function removeP2pNotes(): Promise<P2pSaveState> {
  const account = await currentAccount();
  if (!account) return { status: "error", message: "Sign in first." };
  const key = safeKey();
  if (!key) return { status: "error", message: "Prism can't do that right now. Try again later." };
  try {
    await saveAccountP2pNotes(account, NO_P2P_NOTES, key);
  } catch {
    return { status: "error", message: "That didn't work. Try again in a moment." };
  }
  refresh();
  return { status: "saved", message: "Your payment notes are gone. Add your files again any time to bring them back.", saved: 0, at: Date.now() };
}
