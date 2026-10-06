// src/lib/billing/plus.ts
//
// Who may use what: the one place the server asks whether someone has Prism
// Plus. Every gate reads `plusFor`, never the billing table or Stripe itself.
//
// With billing off (no Stripe keys here: a laptop, a preview, production
// until the owner switches it on) everything is open to everyone, exactly as
// before Prism Plus (`EVERYTHING_OPEN`). With it on, a person has Plus while
// their own subscription counts, or while someone in their household pays
// for the Household plan; the household's shared view opens while anyone in
// it pays for either (migration billing, `my_plan`).
//
// If the database can't be asked, Prism errs toward the person: the gates
// open (`checked: false`). Nobody who pays should meet a paywall because of
// an outage of ours, and a few free minutes cost little.

import "server-only";
import { after } from "next/server";
import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/supabase/config";
import type { Account } from "@/lib/supabase/server";
import { FREE_CONNECTIONS, type Interval, type PlanId, type PlusFeature } from "./plans";
import { readSubscription, stripeConfig, subscriptionRecord, type StripeConfig, type SubscriptionRecord } from "./stripe";

export type OwnSubscription = {
  plan: PlanId;
  interval: Interval;
  /** Stripe's word for it: trialing, active, past_due, canceled… */
  status: string;
  /** The end of the time paid for (or of the trial). */
  periodEnd: string | null;
  trialEnd: string | null;
  /** When it stops, if it's been cancelled; null while it renews. */
  endsAt: string | null;
  /** It gives them Plus right now. */
  counts: boolean;
};

export type Plus = {
  /** Billing is on here, so some things need Prism Plus. Off, everything is open to everyone. */
  billing: boolean;
  /** Whether the database was asked and answered; false means the gates were left open. */
  checked: boolean;
  /** They may use every part of Prism Plus. */
  plus: boolean;
  /** Their household's shared view is open: they have Plus, or someone in their household pays for either plan. */
  householdView: boolean;
  own: OwnSubscription | null;
  /** Plus reaches them through someone's Household plan rather than a subscription of their own. */
  covered: boolean;
  customerId: string | null;
  subscriptionId: string | null;
  /** Their first subscription here would start with the free days. */
  trial: boolean;
};

export const EVERYTHING_OPEN: Plus = {
  billing: false,
  checked: true,
  plus: true,
  householdView: true,
  own: null,
  covered: false,
  customerId: null,
  subscriptionId: null,
  trial: false,
};

/** Billing is switched on here: Stripe's keys, the job secret, and accounts. */
export function billingConfig(): StripeConfig | null {
  return supabaseEnv() ? stripeConfig() : null;
}

type PlanRow = {
  plan: PlanId | null;
  billing_interval: Interval | null;
  status: string | null;
  period_end: string | null;
  trial_end: string | null;
  ends_at: string | null;
  customer_id: string | null;
  subscription_id: string | null;
  own_plus: boolean;
  household_plan: boolean;
  household_plus: boolean;
  subscribed_before: boolean;
};

/** What a person's plan row says, as the gates read it. Pure, for the tests. */
export function plusFromRow(r: PlanRow): Plus {
  const own: OwnSubscription | null =
    r.plan && r.billing_interval && r.status
      ? { plan: r.plan, interval: r.billing_interval, status: r.status, periodEnd: r.period_end, trialEnd: r.trial_end, endsAt: r.ends_at, counts: r.own_plus }
      : null;
  const plus = r.own_plus || r.household_plan;
  return {
    billing: true,
    checked: true,
    plus,
    householdView: plus || r.household_plus,
    own,
    covered: !r.own_plus && r.household_plan,
    customerId: r.customer_id,
    subscriptionId: r.subscription_id,
    trial: !r.subscribed_before,
  };
}

/** Prism Plus for this person (or someone signed out), once per request. */
export const plusFor = cache(async (account: Account | null): Promise<Plus> => {
  const config = billingConfig();
  if (!config) return EVERYTHING_OPEN;
  if (!account) return { ...EVERYTHING_OPEN, billing: true, plus: false, householdView: false, trial: true };
  const { data, error } = await account.supabase.rpc("my_plan", { p_livemode: config.livemode });
  const row = Array.isArray(data) ? (data[0] as PlanRow | undefined) : undefined;
  if (error || !row) {
    console.error("Prism Plus: couldn't read a plan, so its gates are open for this request:", error?.code ?? "no row");
    return { ...EVERYTHING_OPEN, billing: true, checked: false };
  }
  const plus = plusFromRow(row);
  // A subscription that should have renewed a day ago and hasn't been heard of since: ask Stripe, after the response.
  const own = plus.own;
  if (own?.counts && own.periodEnd && Date.parse(own.periodEnd) < Date.now() - 24 * 60 * 60_000 && plus.subscriptionId) {
    const id = plus.subscriptionId;
    after(() => syncSubscription(config, id).catch((e: unknown) => console.error("Prism Plus: a subscription wasn't read again:", e instanceof Error ? e.name : "unknown error")));
  }
  return plus;
});

/**
 * Whether connecting this needs Prism Plus they don't have: an investment
 * account or Coinbase always does, a bank once they have the free plan's one.
 * A count that can't be read errs toward the person, like `plusFor`.
 */
export async function connectionNeedsPlus(account: Account, kind: "bank" | "investments" | "coinbase"): Promise<PlusFeature | null> {
  if ((await plusFor(account)).plus) return null;
  if (kind !== "bank") return kind;
  const { count, error } = await account.supabase.from("plaid_items").select("item_id", { count: "exact", head: true }).eq("user_id", account.userId);
  if (error) return null;
  return (count ?? 0) >= FREE_CONNECTIONS ? "banks" : null;
}

/** Writes go through the database's one door for them, with the job secret: there is no other key. */
function jobClient() {
  const env = supabaseEnv();
  if (!env) throw new Error("Accounts aren't set up here.");
  return createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export type RecordOutcome = "recorded" | "older" | "no-person";

/** Keeps what Stripe just said about a subscription. `at` is when it was read from Stripe. */
export async function recordSubscription(config: StripeConfig, r: SubscriptionRecord, at = new Date()): Promise<RecordOutcome> {
  const { data, error } = await jobClient().rpc("billing_record", {
    p_secret: config.jobSecret,
    p_user_id: r.userId,
    p_livemode: r.livemode,
    p_customer_id: r.customerId,
    p_subscription_id: r.subscriptionId,
    p_created: r.created,
    p_plan: r.plan,
    p_interval: r.interval,
    p_status: r.status,
    p_period_end: r.periodEnd,
    p_trial_end: r.trialEnd,
    p_ends_at: r.endsAt,
    p_at: at.toISOString(),
  });
  if (error) throw new Error(`The billing record was refused (${error.code ?? "unknown"}).`);
  return data as RecordOutcome;
}

/**
 * Reads a subscription from Stripe and keeps it. "ignored" when Stripe has no
 * such subscription, it's from the other Stripe mode, or it isn't one of
 * Prism's (no person, or a price Prism doesn't sell; the second is logged,
 * because it means a price in Stripe needs its lookup key).
 */
export async function syncSubscription(config: StripeConfig, id: string, fallbackUser?: string | null): Promise<RecordOutcome | "ignored"> {
  const at = new Date();
  const sub = await readSubscription(config, id);
  if (!sub || sub.livemode !== config.livemode) return "ignored";
  const record = subscriptionRecord(sub, fallbackUser);
  if ("problem" in record) {
    if (record.problem !== "no-person") console.error(`Prism Plus: subscription not recorded (${record.problem}). Check its price's lookup key in Stripe.`);
    return "ignored";
  }
  return recordSubscription(config, record, at);
}
