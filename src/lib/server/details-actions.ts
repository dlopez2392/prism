"use server";

// src/lib/server/details-actions.ts
//
// Keeping what a person adds to their own transactions (finance/details.ts):
// a split, their tags, who owes them, and what they leave out of their totals
// (a line, or a whole account). Only for a signed-in account, only on
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
import { checkDetail, ruleKey, sharesOf, validRule, withDetail, withHidden, withRule, wholeLines, type SplitRule, type TxnDetail } from "@/lib/finance/details";
import { currentAccount } from "@/lib/supabase/server";
import { loadAccountDetails, saveAccountDetails } from "./account-store";
import { getPersonalFinance } from "./finance";
import { vaultKey } from "./vault";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/t";

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
  if (!account) return { ok: false, error: msg("Sign in to keep these. They're kept in your account.") } as const;
  const key = safeKey();
  if (!key) return { ok: false, error: msg("Prism can't save that right now. Try again later.") } as const;
  return { ok: true, account, key } as const;
}

/** The person's own line, whole, by the id the bank gave it; or why there isn't one to change. */
async function ownLine(txnId: unknown) {
  const me = await ownAccount();
  if (!me.ok) return me;
  const { account, key } = me;
  if (typeof txnId !== "string" || !txnId || txnId.length > 200) return { ok: false, error: msg("That transaction isn't one of yours.") } as const;
  const data = await getPersonalFinance();
  if (data.source === "demo") return { ok: false, error: msg("Link a bank first. Splits and tags go on your own transactions.") } as const;
  const line = wholeLines(data.transactions).find((t) => t.id === txnId && !t.pending);
  if (!line) return { ok: false, error: msg("That transaction isn't one of yours, or it's still pending.") } as const;
  return { ok: true, account, key, line, today: data.today } as const;
}

/** Set (or clear) a line's split, tags and who owes for it, all at once, as the dialog shows them. */
export async function saveTransactionDetail(txnId: unknown, detail: unknown): Promise<DetailState> {
  const t = await getT();
  try {
    const own = await ownLine(txnId);
    if (!own.ok) return { status: "error", message: t(own.error) };
    const checked = checkDetail(own.line, detail, t);
    if ("error" in checked) return { status: "error", message: checked.error };
    const current = await loadAccountDetails(own.account, own.key);
    // Paid back stays paid back: the dialog never sends the day, so keep the one already recorded.
    const was = current.lines[own.line.id]?.owed;
    let kept: TxnDetail | null = checked.detail?.owed && was?.paid && was.who === checked.detail.owed.who && was.amount === checked.detail.owed.amount ? { ...checked.detail, owed: { ...checked.detail.owed, paid: was.paid } } : checked.detail;
    const shop = ruleKey(own.line.merchant);
    const hasRule = shop !== null && Object.hasOwn(current.rules ?? {}, shop);
    const rule = detail && typeof detail === "object" ? (detail as Record<string, unknown>).rule : undefined;
    let next = current;
    let message = !kept ? t("Back to how the bank sent it.") : kept.split ? t("Split into {n} parts. Every total now counts them that way.", { n: kept.split.length }) : t("Saved.");
    if (kept?.split && rule === true && shop !== null) {
      const shares = sharesOf(kept.split);
      if (!shares) return { status: "error", message: t("A part is too small to split every purchase by. Make each a little bigger, or split just this one.") };
      next = withRule(next, shop, { name: own.line.merchant, split: shares });
      // This one follows the shop's split like the rest, so it keeps only its tags and who owes for it.
      const rest: TxnDetail = { ...kept };
      delete rest.split;
      kept = Object.keys(rest).length ? rest : null;
      message = t("Split into {n} parts, and so is every {merchant} purchase.", { n: shares.length, merchant: own.line.merchant });
    } else if (kept?.split && rule === false && hasRule) {
      next = withRule(next, shop!, null);
      message = t("Split into {n} parts. Other {merchant} purchases aren't split any more.", { n: kept.split.length, merchant: own.line.merchant });
    } else if (!kept?.split && hasRule) {
      kept = { ...(kept ?? {}), whole: true };
      message = t("Kept whole. Other {merchant} purchases still follow your split.", { merchant: own.line.merchant });
    }
    // Left out stays left out: that's the switch above the form, never something the form sends.
    if (current.lines[own.line.id]?.out) kept = { ...(kept ?? {}), out: true };
    await saveAccountDetails(own.account, withDetail(next, own.line.id, kept), own.key);
    refresh();
    return { status: "saved", message, at: Date.now() };
  } catch {
    return { status: "error", message: t("That didn't save. Try again in a moment.") };
  }
}

/** Set (or remove, with null) the split every purchase at one shop follows: the Spending page's list, and its Undo. */
export async function setSplitRule(shop: unknown, rule: unknown): Promise<DetailState> {
  const t = await getT();
  try {
    const me = await ownAccount();
    if (!me.ok) return { status: "error", message: t(me.error) };
    if (typeof shop !== "string" || ruleKey(shop) !== shop) return { status: "error", message: t("That shop's split isn't one of yours.") };
    const valid: SplitRule | null = rule === null ? null : validRule(rule);
    if (rule !== null && !valid) return { status: "error", message: t("That split doesn't add up to the whole purchase.") };
    const current = await loadAccountDetails(me.account, me.key);
    if (!valid && !Object.hasOwn(current.rules ?? {}, shop)) return { status: "error", message: t("That shop has no split to remove.") };
    await saveAccountDetails(me.account, withRule(current, shop, valid), me.key);
    refresh();
    return {
      status: "saved",
      message: valid ? t("Every {merchant} purchase is split again.", { merchant: valid.name }) : t("Removed. Those purchases are back to how the bank sent them."),
      at: Date.now(),
    };
  } catch {
    return { status: "error", message: t("That didn't save. Try again in a moment.") };
  }
}

/** Mark what someone owed as paid back (or open again): the rest of the line stays as it is. */
export async function markOwedPaid(txnId: unknown, paid: unknown): Promise<DetailState> {
  const t = await getT();
  try {
    const own = await ownLine(txnId);
    if (!own.ok) return { status: "error", message: t(own.error) };
    const current = await loadAccountDetails(own.account, own.key);
    const detail = current.lines[own.line.id];
    if (!detail?.owed) return { status: "error", message: t("Nobody owes you for that one.") };
    const next = { ...detail, owed: { ...detail.owed, paid: paid === true ? own.today : null } };
    await saveAccountDetails(own.account, withDetail(current, own.line.id, next), own.key);
    refresh();
    return {
      status: "saved",
      message: paid === true ? t("Marked paid back by {who}.", { who: detail.owed.who }) : t("Open again: {who} still owes you.", { who: detail.owed.who }),
      at: Date.now(),
    };
  } catch {
    return { status: "error", message: t("That didn't save. Try again in a moment.") };
  }
}

/** Leave one of the person's lines out of every total (or count it again): the rest of what they added to it stays as it is. */
export async function leaveOut(txnId: unknown, out: unknown): Promise<DetailState> {
  const t = await getT();
  try {
    if (typeof out !== "boolean") return { status: "error", message: t("That didn't come through. Try again.") };
    const own = await ownLine(txnId);
    if (!own.ok) return { status: "error", message: t(own.error) };
    const current = await loadAccountDetails(own.account, own.key);
    const next: TxnDetail = { ...current.lines[own.line.id] };
    if (out === true) next.out = true;
    else delete next.out;
    await saveAccountDetails(own.account, withDetail(current, own.line.id, Object.keys(next).length ? next : null), own.key);
    refresh();
    return { status: "saved", message: out === true ? t("Left out of your totals. It stays in your transactions.") : t("Counted in your totals again."), at: Date.now() };
  } catch {
    return { status: "error", message: t("That didn't save. Try again in a moment.") };
  }
}

/** Leave one of the person's accounts out of every total (or count it again): its balance, and every line in it. It stays connected. */
export async function countAccount(accountId: unknown, counted: unknown): Promise<DetailState> {
  const t = await getT();
  try {
    if (typeof counted !== "boolean") return { status: "error", message: t("That didn't come through. Try again.") };
    const me = await ownAccount();
    if (!me.ok) return { status: "error", message: t(me.error) };
    const data = await getPersonalFinance();
    if (data.source === "demo") return { status: "error", message: t("Link a bank first. This is for your own accounts.") };
    const account = typeof accountId === "string" ? [...data.accounts, ...(data.hiddenAccounts ?? [])].find((a) => a.id === accountId) : undefined;
    if (!account) return { status: "error", message: t("That account isn't one of yours.") };
    const current = await loadAccountDetails(me.account, me.key);
    await saveAccountDetails(me.account, withHidden(current, account.id, counted !== true), me.key);
    refresh();
    return {
      status: "saved",
      message: counted === true ? t("{account} counts in your totals again.", { account: account.name }) : t("{account} is left out of your totals. It's still connected.", { account: account.name }),
      at: Date.now(),
    };
  } catch {
    return { status: "error", message: t("That didn't save. Try again in a moment.") };
  }
}
