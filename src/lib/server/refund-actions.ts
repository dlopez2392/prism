"use server";

// src/lib/server/refund-actions.ts
//
// The refunds a person is waiting on (finance/refunds.ts): start waiting on
// one for a line of their own (a return, a fee they asked back, a charge
// twice or after cancelling), say it came back when Prism can't see it, or
// stop waiting. Kept sealed with the rest of what they add to their
// transactions (profiles.sealed_txn_details), only for a signed-in account,
// only on one of their OWN posted lines of money out, never the example
// household's, and never shown to a household. Every change takes effect at
// once and comes back with what Undo needs. Prism never contacts anyone about
// a refund. Next checks each action's Origin against the host (CSRF).

import { refresh } from "next/cache";
import { DETAIL_LIMITS, REFUND_KINDS, validRefundMark, wholeLines, withRefundMark, type RefundKind, type RefundMark } from "@/lib/finance/details";
import { money } from "@/lib/finance/format";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/t";
import { currentAccount } from "@/lib/supabase/server";
import { loadAccountDetails, saveAccountDetails } from "./account-store";
import { getPersonalFinance } from "./finance";
import { vaultKey } from "./vault";

export type RefundState = { status: "idle" } | { status: "saved"; message: string; at: number; undo?: RefundMark | null } | { status: "error"; message: string };

const saved = (message: string, undo?: RefundMark | null): RefundState => ({ status: "saved", message, at: Date.now(), ...(undo !== undefined ? { undo } : {}) });

/** The signed-in person, the key their details are sealed with, and their own money; or why there isn't one. */
async function own() {
  const account = await currentAccount();
  if (!account) return { ok: false, error: msg("Sign in to keep these. They're kept in your account.") } as const;
  let key = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  if (!key) return { ok: false, error: msg("Prism can't save that right now. Try again later.") } as const;
  const data = await getPersonalFinance();
  if (data.source === "demo") return { ok: false, error: msg("Link a bank first. Refunds are found in your own money.") } as const;
  return { ok: true, account, key, data } as const;
}

/** Wait on money back for one of the person's own posted purchases: up to what it cost, for a reason they chose. Replaces any wait already kept for it. */
export async function waitForRefund(txnId: unknown, amount: unknown, kind: unknown): Promise<RefundState> {
  const t = await getT();
  try {
    if (typeof txnId !== "string" || !txnId || txnId.length > 200 || !REFUND_KINDS.includes(kind as RefundKind)) return { status: "error", message: t("That didn't come through. Try again.") };
    const me = await own();
    if (!me.ok) return { status: "error", message: t(me.error) };
    const line = wholeLines(me.data.transactions).find((x) => x.id === txnId && !x.pending);
    if (!line || line.amount >= 0) return { status: "error", message: t("That isn't one of your purchases, or it's still pending.") };
    if (!Number.isSafeInteger(amount) || (amount as number) <= 0) return { status: "error", message: t("Say how much is coming back.") };
    if ((amount as number) > -line.amount) return { status: "error", message: t("At most {total}, what this cost.", { total: money(-line.amount) }) };
    const current = await loadAccountDetails(me.account, me.key);
    const old = current.refunds?.[txnId] ?? null;
    if (!old && Object.keys(current.refunds ?? {}).length >= DETAIL_LIMITS.refunds) return { status: "error", message: t("You're waiting on as many refunds as Prism keeps. Clear one first.") };
    const mark: RefundMark = { name: line.merchant, date: line.date, amount: amount as number, kind: kind as RefundKind, asked: me.data.today };
    await saveAccountDetails(me.account, withRefundMark(current, txnId, validRefundMark(mark)), me.key);
    refresh();
    return saved(t("Waiting on {amount} back from {name}. Prism will spot it when it comes in.", { amount: money(mark.amount), name: line.merchant }), old);
  } catch {
    return { status: "error", message: t("That didn't save. Try again in a moment.") };
  }
}

/** Say a refund came back another way (store credit, cash), today; or that it hasn't after all. */
export async function refundCameBack(txnId: unknown, came: unknown): Promise<RefundState> {
  const t = await getT();
  try {
    if (typeof txnId !== "string" || typeof came !== "boolean") return { status: "error", message: t("That didn't come through. Try again.") };
    const me = await own();
    if (!me.ok) return { status: "error", message: t(me.error) };
    const current = await loadAccountDetails(me.account, me.key);
    const old = current.refunds?.[txnId];
    if (!old) return { status: "error", message: t("You aren't waiting on a refund for that one.") };
    const next: RefundMark = { ...old };
    if (came) next.got = me.data.today;
    else delete next.got;
    await saveAccountDetails(me.account, withRefundMark(current, txnId, next), me.key);
    refresh();
    return saved(came ? t("Marked {amount} back from {name}.", { amount: money(old.amount), name: old.name }) : t("Waiting on {name} again.", { name: old.name }), old);
  } catch {
    return { status: "error", message: t("That didn't save. Try again in a moment.") };
  }
}

/** Stop waiting on a refund (it isn't coming, or it was a mistake). Undo puts it back as it was. */
export async function stopWaiting(txnId: unknown): Promise<RefundState> {
  const t = await getT();
  try {
    if (typeof txnId !== "string") return { status: "error", message: t("That didn't come through. Try again.") };
    const me = await own();
    if (!me.ok) return { status: "error", message: t(me.error) };
    const current = await loadAccountDetails(me.account, me.key);
    const old = current.refunds?.[txnId];
    if (!old) return { status: "error", message: t("You aren't waiting on a refund for that one.") };
    await saveAccountDetails(me.account, withRefundMark(current, txnId, null), me.key);
    refresh();
    return saved(t("No longer waiting on {name}.", { name: old.name }), old);
  } catch {
    return { status: "error", message: t("That didn't save. Try again in a moment.") };
  }
}

/** Undo: put a refund back as it was before the last change (or take it away again, with null). */
export async function putRefund(txnId: unknown, mark: unknown): Promise<RefundState> {
  const t = await getT();
  try {
    if (typeof txnId !== "string" || !txnId || txnId.length > 200 || txnId.includes("~")) return { status: "error", message: t("That didn't come through. Try again.") };
    const kept = mark === null ? null : validRefundMark(mark);
    if (mark !== null && !kept) return { status: "error", message: t("That didn't come through. Try again.") };
    const me = await own();
    if (!me.ok) return { status: "error", message: t(me.error) };
    const current = await loadAccountDetails(me.account, me.key);
    if (kept && !current.refunds?.[txnId] && Object.keys(current.refunds ?? {}).length >= DETAIL_LIMITS.refunds) return { status: "error", message: t("You're waiting on as many refunds as Prism keeps. Clear one first.") };
    await saveAccountDetails(me.account, withRefundMark(current, txnId, kept), me.key);
    refresh();
    return saved(t("Undone."));
  } catch {
    return { status: "error", message: t("That didn't save. Try again in a moment.") };
  }
}
