"use server";

// src/lib/server/subscription-actions.ts
//
// What a person tells Prism about their subscriptions, on the Subscriptions
// page (finance/subscriptions.ts): that a repeating charge is one, or isn't;
// that they cancelled one (Prism Plus: from then on Prism watches for a
// charge that shouldn't come); and the ones Prism can't see, added by hand.
// Kept sealed with the rest of what they add to their transactions
// (profiles.sealed_txn_details), only for a signed-in account, only about
// their OWN repeating charges as their own view finds them, never the
// example household's, and never shown to a household. Every change takes
// effect at once and comes back with what Undo needs. Next checks each
// action's Origin against the host (CSRF).

import { randomBytes } from "node:crypto";
import { refresh } from "next/cache";
import { plusNeeds } from "@/lib/billing/plans";
import { plusFor } from "@/lib/billing/plus";
import { DETAIL_LIMITS, OWN_CADENCES, validOwnSub, withOwnSub, withSubMark, type OwnCadence, type OwnSub, type SubMark, type TxnDetails } from "@/lib/finance/details";
import { analyze } from "@/lib/finance/model";
import { parseDollars, type FieldErrors, type PlanFormState } from "@/lib/finance/plan";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/t";
import { currentAccount } from "@/lib/supabase/server";
import { loadAccountDetails, saveAccountDetails } from "./account-store";
import { getPersonalFinance } from "./finance";
import { vaultKey } from "./vault";

export type SubscriptionState = { status: "idle" } | { status: "saved"; message: string; at: number } | { status: "error"; message: string };

const saved = (message: string): SubscriptionState => ({ status: "saved", message, at: Date.now() });

/** The signed-in person, the key their notes are sealed with, and their own money; or why there isn't one. */
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
  if (data.source === "demo") return { ok: false, error: msg("Link a bank first. Your subscriptions are found in your own money.") } as const;
  return { ok: true, account, key, data } as const;
}

/** The mark kept for a shop, with one part changed; null when nothing would be left. */
function marked(old: SubMark | undefined, name: string, change: Partial<Pick<SubMark, "is" | "cancelled">> & { clearIs?: true; clearCancelled?: true }): SubMark | null {
  const next: SubMark = { name, ...(old?.is !== undefined ? { is: old.is } : {}), ...(old?.cancelled ? { cancelled: old.cancelled } : {}) };
  if (change.is !== undefined) next.is = change.is;
  if (change.clearIs) delete next.is;
  if (change.cancelled) next.cancelled = change.cancelled;
  if (change.clearCancelled) delete next.cancelled;
  return next.is === undefined && !next.cancelled ? null : next;
}

/**
 * Say a repeating charge is a subscription (true), isn't (false), or leave it
 * to Prism again (null, which is also Undo). Only a shop the person's own
 * repeating charges come from.
 */
export async function markSubscription(key: unknown, is: unknown): Promise<SubscriptionState> {
  const t = await getT();
  try {
    if (typeof key !== "string" || (is !== true && is !== false && is !== null)) return { status: "error", message: t("That didn't come through. Try again.") };
    const me = await own();
    if (!me.ok) return { status: "error", message: t(me.error) };
    const s = analyze(me.data).subscriptions;
    const current = await loadAccountDetails(me.account, me.key);
    const row = s.active.find((r) => r.key === key && r.streamId !== null) ?? s.others.find((o) => o.key === key);
    const old = current.subs?.[key];
    if (!row && !old) return { status: "error", message: t("That isn't one of your repeating charges.") };
    const name = row?.name ?? old!.name;
    const mark = is === null ? marked(old, name, { clearIs: true }) : marked(old, name, { is });
    if (!old && mark && Object.keys(current.subs ?? {}).length >= DETAIL_LIMITS.subs) return { status: "error", message: t("You've marked as many as Prism keeps. Clear one first.") };
    await saveAccountDetails(me.account, withSubMark(current, key, mark), me.key);
    refresh();
    if (is === true) return saved(t("{name} is on your subscriptions.", { name }));
    if (is === false) return saved(t("{name} is off your subscriptions. It's under other repeating charges.", { name }));
    return saved(t("Back to how Prism found {name}.", { name }));
  } catch {
    return { status: "error", message: t("That didn't save. Try again in a moment.") };
  }
}

/**
 * Say a subscription is cancelled, as of today (true), or isn't after all
 * (false, which is also Undo). Prism Plus: from then on any charge from the
 * shop that comes after it is caught (subscriptions.ts, alerts.ts).
 */
export async function cancelSubscription(key: unknown, cancelled: unknown): Promise<SubscriptionState> {
  const t = await getT();
  try {
    if (typeof key !== "string" || typeof cancelled !== "boolean") return { status: "error", message: t("That didn't come through. Try again.") };
    const me = await own();
    if (!me.ok) return { status: "error", message: t(me.error) };
    if (!(await plusFor(me.account)).plus) return { status: "error", message: plusNeeds("subscriptions", t) };
    const current = await loadAccountDetails(me.account, me.key);
    const old = current.subs?.[key];
    if (!cancelled) {
      if (!old?.cancelled) return { status: "error", message: t("That one isn't marked cancelled.") };
      await saveAccountDetails(me.account, withSubMark(current, key, marked(old, old.name, { clearCancelled: true })), me.key);
      refresh();
      return saved(t("{name} is back on your subscriptions.", { name: old.name }));
    }
    const row = analyze(me.data).subscriptions.active.find((r) => r.key === key && r.streamId !== null);
    if (!row) return { status: "error", message: t("That isn't one of your subscriptions.") };
    if (!old && Object.keys(current.subs ?? {}).length >= DETAIL_LIMITS.subs) return { status: "error", message: t("You've marked as many as Prism keeps. Clear one first.") };
    const mark = marked(old, row.name, { cancelled: { on: me.data.today, amount: row.amount, cadence: row.cadence } });
    await saveAccountDetails(me.account, withSubMark(current, key, mark), me.key);
    refresh();
    return saved(t("{name} is marked cancelled. Prism will tell you if it charges you again.", { name: row.name }));
  } catch {
    return { status: "error", message: t("That didn't save. Try again in a moment.") };
  }
}

const isOwnCadence = (x: unknown): x is OwnCadence => OWN_CADENCES.includes(x as OwnCadence);
const newId = () => `own-${randomBytes(6).toString("hex")}`;

/** Add a subscription Prism can't see, or change one added before: from the page's form. */
export async function saveOwnSubscription(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const t = await getT();
  try {
    const me = await own();
    if (!me.ok) return { status: "error", message: t(me.error) };
    const fields: FieldErrors = {};
    const name = String(form.get("name") ?? "");
    const amount = parseDollars(String(form.get("amount") ?? ""));
    const cadence = form.get("cadence");
    const next = String(form.get("next") ?? "");
    const idRaw = form.get("id");
    if (!name.trim()) fields.name = t("Give it a name.");
    if (amount === null || amount <= 0 || amount > DETAIL_LIMITS.subAmount) fields.amount = t("Enter what it costs each time, up to $10,000.");
    if (!isOwnCadence(cadence)) fields.cadence = t("Choose how often it charges you.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) fields.next = t("Choose the day of its next charge.");
    if (Object.keys(fields).length) return { status: "error", message: t("Check the highlighted fields."), fields };
    const current = await loadAccountDetails(me.account, me.key);
    const editing = typeof idRaw === "string" && idRaw ? (current.own ?? []).find((o) => o.id === idRaw) : undefined;
    if (typeof idRaw === "string" && idRaw && !editing) return { status: "error", message: t("That subscription isn't one you added.") };
    if (!editing && (current.own?.length ?? 0) >= DETAIL_LIMITS.own) return { status: "error", message: t("You've added as many as Prism keeps ({n}). Remove one first.", { n: DETAIL_LIMITS.own }) };
    const sub = validOwnSub({ id: editing?.id ?? newId(), name, amount, cadence, next });
    if (!sub) return { status: "error", message: t("Check the highlighted fields."), fields: { next: t("Choose the day of its next charge.") } };
    await saveAccountDetails(me.account, withOwnSub(current, sub), me.key);
    refresh();
    return { status: "saved", message: editing ? t("{name} is updated.", { name: sub.name }) : t("{name} is on your subscriptions.", { name: sub.name }), at: Date.now() };
  } catch {
    return { status: "error", message: t("That didn't save. Try again in a moment.") };
  }
}

/** Take out one added by hand, by its id; the page keeps the subscription itself, so Undo can put it back (putOwnSubscription). */
export async function removeOwnSubscription(id: unknown): Promise<SubscriptionState> {
  const t = await getT();
  try {
    const me = await own();
    if (!me.ok) return { status: "error", message: t(me.error) };
    const current = await loadAccountDetails(me.account, me.key);
    const sub = typeof id === "string" ? (current.own ?? []).find((o) => o.id === id) : undefined;
    if (!sub) return { status: "error", message: t("That subscription isn't one you added.") };
    await saveAccountDetails(me.account, withOwnSub(current, sub, true), me.key);
    refresh();
    return saved(t("{name} is off your subscriptions.", { name: sub.name }));
  } catch {
    return { status: "error", message: t("That didn't save. Try again in a moment.") };
  }
}

/** Undo for removeOwnSubscription: the same subscription, back as it was, checked like any other. */
export async function putOwnSubscription(sub: unknown): Promise<SubscriptionState> {
  const t = await getT();
  try {
    const me = await own();
    if (!me.ok) return { status: "error", message: t(me.error) };
    const valid: OwnSub | null = validOwnSub(sub);
    if (!valid) return { status: "error", message: t("That didn't come through. Try again.") };
    const current: TxnDetails = await loadAccountDetails(me.account, me.key);
    const replacing = (current.own ?? []).some((o) => o.id === valid.id);
    if (!replacing && (current.own?.length ?? 0) >= DETAIL_LIMITS.own) return { status: "error", message: t("You've added as many as Prism keeps ({n}). Remove one first.", { n: DETAIL_LIMITS.own }) };
    await saveAccountDetails(me.account, withOwnSub(current, valid), me.key);
    refresh();
    return saved(t("{name} is on your subscriptions.", { name: valid.name }));
  } catch {
    return { status: "error", message: t("That didn't save. Try again in a moment.") };
  }
}
