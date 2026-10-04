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
//
// A split can follow its shop (`rule: true`): it's kept as shares for every
// purchase there, and this one follows it too. With the box unticked, the
// shop's split is removed and this one keeps its own. A purchase at a shop
// with a split, saved with none, is kept whole: the others still follow.

import { refresh } from "next/cache";
import { checkDetail, ruleKey, sharesOf, validRule, withDetail, withRule, wholeLines, type SplitRule, type TxnDetail } from "@/lib/finance/details";
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

/** The signed-in person and the key their details are sealed with; or why there isn't one. */
async function ownAccount() {
  const account = await currentAccount();
  if (!account) return { ok: false, error: "Sign in to keep these. They're kept in your account." } as const;
  const key = safeKey();
  if (!key) return { ok: false, error: "Prism can't save that right now. Try again later." } as const;
  return { ok: true, account, key } as const;
}

/** The person's own line, whole, by the id the bank gave it; or why there isn't one to change. */
async function ownLine(txnId: unknown) {
  const me = await ownAccount();
  if (!me.ok) return me;
  const { account, key } = me;
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
    let kept: TxnDetail | null = checked.detail?.owed && was?.paid && was.who === checked.detail.owed.who && was.amount === checked.detail.owed.amount ? { ...checked.detail, owed: { ...checked.detail.owed, paid: was.paid } } : checked.detail;
    const shop = ruleKey(own.line.merchant);
    const hasRule = shop !== null && Object.hasOwn(current.rules ?? {}, shop);
    const rule = detail && typeof detail === "object" ? (detail as Record<string, unknown>).rule : undefined;
    let next = current;
    let message = !kept ? "Back to how the bank sent it." : kept.split ? `Split into ${kept.split.length} parts. Every total now counts them that way.` : "Saved.";
    if (kept?.split && rule === true && shop !== null) {
      const shares = sharesOf(kept.split);
      if (!shares) return { status: "error", message: "A part is too small to split every purchase by. Make each a little bigger, or split just this one." };
      next = withRule(next, shop, { name: own.line.merchant, split: shares });
      // This one follows the shop's split like the rest, so it keeps only its tags and who owes for it.
      const rest: TxnDetail = { ...kept };
      delete rest.split;
      kept = Object.keys(rest).length ? rest : null;
      message = `Split into ${shares.length} parts, and so is every ${own.line.merchant} purchase.`;
    } else if (kept?.split && rule === false && hasRule) {
      next = withRule(next, shop!, null);
      message = `Split into ${kept.split.length} parts. Other ${own.line.merchant} purchases aren't split any more.`;
    } else if (!kept?.split && hasRule) {
      kept = { ...(kept ?? {}), whole: true };
      message = `Kept whole. Other ${own.line.merchant} purchases still follow your split.`;
    }
    await saveAccountDetails(own.account, withDetail(next, own.line.id, kept), own.key);
    refresh();
    return { status: "saved", message, at: Date.now() };
  } catch {
    return { status: "error", message: "That didn't save. Try again in a moment." };
  }
}

/** Set (or remove, with null) the split every purchase at one shop follows: the Spending page's list, and its Undo. */
export async function setSplitRule(shop: unknown, rule: unknown): Promise<DetailState> {
  try {
    const me = await ownAccount();
    if (!me.ok) return { status: "error", message: me.error };
    if (typeof shop !== "string" || ruleKey(shop) !== shop) return { status: "error", message: "That shop's split isn't one of yours." };
    const valid: SplitRule | null = rule === null ? null : validRule(rule);
    if (rule !== null && !valid) return { status: "error", message: "That split doesn't add up to the whole purchase." };
    const current = await loadAccountDetails(me.account, me.key);
    if (!valid && !Object.hasOwn(current.rules ?? {}, shop)) return { status: "error", message: "That shop has no split to remove." };
    await saveAccountDetails(me.account, withRule(current, shop, valid), me.key);
    refresh();
    return { status: "saved", message: valid ? `Every ${valid.name} purchase is split again.` : "Removed. Those purchases are back to how the bank sent them.", at: Date.now() };
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
