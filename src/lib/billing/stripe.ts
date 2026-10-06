// src/lib/billing/stripe.ts
//
// Stripe, for Prism Plus: prices, Checkout, the customer portal, reading a
// subscription back, and checking a webhook's signature. Plain HTTPS to
// Stripe's API with `fetch` and `node:crypto`, like the push alerts, so there
// is no SDK to keep up with; the API version is pinned (STRIPE_VERSION), so
// what Stripe sends back keeps the shape this file reads.
//
// Prism never sees a card: Checkout and the portal are Stripe's own pages.
// What Prism keeps of a subscription is its copy in the billing table
// (migration billing), written only from what the server itself just read
// from Stripe.
//
// Billing is on only where all three secrets are set (`stripeConfig`): the
// Stripe key, the webhook's signing secret, and the job secret the database
// answers to (CRON_SECRET, production only). Anywhere else, nobody is asked
// to pay and everything is open, as before Prism Plus.

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { BRAND } from "@/lib/brand";
import type { Locale } from "@/lib/i18n/locale";
import type { T } from "@/lib/i18n/t";
import { CURRENCY, LOOKUP_KEYS, planOfLookupKey, priceLabel, PRICES, TRIAL_DAYS, type Interval, type PlanId } from "./plans";

/** The Stripe API version Prism is written against. Moving it means reading Stripe's changelog for every field below. */
export const STRIPE_VERSION = "2026-09-30.endive";
const API = "https://api.stripe.com";

export type StripeConfig = { secretKey: string; webhookSecret: string; jobSecret: string; livemode: boolean };

let warned = false;

/** Billing's three secrets, or null when billing is off here. A key that's set but malformed is said once in the log, by name only. */
export function stripeConfig(env: Record<string, string | undefined> = process.env): StripeConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  const jobSecret = env.CRON_SECRET?.trim() ?? "";
  if (!secretKey && !webhookSecret) return null;
  const problems = [
    /^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(secretKey) ? null : "STRIPE_SECRET_KEY",
    /^whsec_[A-Za-z0-9+/=]{10,}$/.test(webhookSecret) ? null : "STRIPE_WEBHOOK_SECRET",
    jobSecret.length >= 32 ? null : "CRON_SECRET",
  ].filter(Boolean);
  if (problems.length) {
    if (!warned) console.error(`Prism Plus is off: ${problems.join(", ")} missing or not in the expected form.`);
    warned = true;
    return null;
  }
  return { secretKey, webhookSecret, jobSecret, livemode: /^(sk|rk)_live_/.test(secretKey) };
}

export class StripeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "StripeError";
  }
}

type Params = { [key: string]: Param };
type Param = string | number | boolean | null | undefined | Params | Param[];

/** Stripe's form encoding: `line_items[0][price]=…`. Empty values are left out. */
export function formEncode(params: Params): string {
  const out = new URLSearchParams();
  const walk = (prefix: string, value: Param) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(`${prefix}[${i}]`, v));
    else if (typeof value === "object") for (const [k, v] of Object.entries(value)) walk(prefix ? `${prefix}[${k}]` : k, v);
    else out.append(prefix, String(value));
  };
  walk("", params);
  return out.toString();
}

async function stripe<R>(config: StripeConfig, method: "GET" | "POST" | "DELETE", path: string, params?: Params): Promise<R> {
  const query = method !== "POST" && params ? `?${formEncode(params)}` : "";
  const res = await fetch(`${API}${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Stripe-Version": STRIPE_VERSION,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" && params ? formEncode(params) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) throw new StripeError(res.status, body?.error?.code ?? null, body?.error?.message ?? `Stripe answered ${res.status}`);
  return body as R;
}

export type StripePrice = {
  id: string;
  active: boolean;
  lookup_key: string | null;
  currency: string;
  unit_amount: number | null;
  recurring: { interval: string; interval_count: number } | null;
};

/** Why a price can't be sold as this plan, or null when it's exactly what the pricing page shows. */
export function priceProblem(price: StripePrice | undefined, plan: PlanId, interval: Interval): string | null {
  if (!price) return `no active price with lookup key ${LOOKUP_KEYS[plan][interval]}`;
  if (!price.active) return `${price.lookup_key} is archived`;
  if (price.currency !== CURRENCY) return `${price.lookup_key} is in ${price.currency}, not ${CURRENCY}`;
  if (price.unit_amount !== PRICES[plan][interval]) return `${price.lookup_key} costs ${price.unit_amount} cents, not ${PRICES[plan][interval]}`;
  if (price.recurring?.interval !== interval || price.recurring.interval_count !== 1) return `${price.lookup_key} doesn't renew every ${interval}`;
  return null;
}

const priceCache = new Map<boolean, { at: number; prices: Map<string, StripePrice> }>();
const PRICE_TTL_MS = 10 * 60_000;

/** The four prices Prism sells, by lookup key, from Stripe: kept ten minutes, so a price fixed in Stripe's dashboard soon counts. */
export async function sellingPrices(config: StripeConfig, now = Date.now()): Promise<Map<string, StripePrice>> {
  const kept = priceCache.get(config.livemode);
  if (kept && now - kept.at < PRICE_TTL_MS) return kept.prices;
  const keys = Object.values(LOOKUP_KEYS).flatMap((k) => Object.values(k));
  const list = await stripe<{ data: StripePrice[] }>(config, "GET", "/v1/prices", { active: true, limit: 10, lookup_keys: keys });
  const prices = new Map(list.data.filter((p) => p.lookup_key).map((p) => [p.lookup_key!, p]));
  priceCache.set(config.livemode, { at: now, prices });
  return prices;
}

/** Stripe's language for its own pages: Latin American Spanish, which is how Prism writes. */
function stripeLocale(locale: Locale): string {
  return locale === "es" ? "es-419" : "en";
}

/** The words beside Checkout's button: what renews, when, for how much, and how to stop it (state auto-renewal laws want this there). */
export function renewalNote(plan: PlanId, interval: Interval, trial: boolean, t: T): string {
  const price = priceLabel(PRICES[plan][interval]);
  const name = plan === "household" ? t("{plus} for your household", { plus: BRAND.plus }) : BRAND.plus;
  const renews =
    interval === "month"
      ? t("{name} renews automatically at {price} a month, plus any sales tax, until you cancel.", { name, price })
      : t("{name} renews automatically at {price} a year, plus any sales tax, until you cancel.", { name, price });
  const cancel = trial
    ? t("Your first {n} days are free: cancel before they end, on your Account page in {product}, and you won't be charged.", { n: TRIAL_DAYS, product: BRAND.product })
    : t("Cancel any time on your Account page in {product}; you keep {plus} until the end of the time you've paid for.", { product: BRAND.product, plus: BRAND.plus });
  return `${renews} ${cancel}`;
}

export type CheckoutRequest = {
  userId: string;
  email: string | null;
  /** Their Stripe customer from an earlier subscription, so Stripe keeps one record of them. */
  customerId: string | null;
  plan: PlanId;
  interval: Interval;
  priceId: string;
  trial: boolean;
  origin: string;
  t: T;
};

/** A Checkout page for one subscription; its address. */
export async function createCheckout(config: StripeConfig, r: CheckoutRequest): Promise<string> {
  const session = await stripe<{ url: string | null }>(config, "POST", "/v1/checkout/sessions", {
    mode: "subscription",
    line_items: [{ price: r.priceId, quantity: 1 }],
    success_url: `${r.origin}/api/stripe/return?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${r.origin}/pricing`,
    client_reference_id: r.userId,
    ...(r.customerId ? { customer: r.customerId, customer_update: { address: "auto" } } : { customer_email: r.email }),
    subscription_data: { metadata: { prism_user: r.userId }, trial_period_days: r.trial ? TRIAL_DAYS : null },
    metadata: { prism_user: r.userId },
    automatic_tax: { enabled: true },
    billing_address_collection: "auto",
    consent_collection: { terms_of_service: "required" },
    custom_text: {
      submit: { message: renewalNote(r.plan, r.interval, r.trial, r.t) },
      terms_of_service_acceptance: { message: r.t("I agree to the [Terms of Service]({url}).", { url: `${r.origin}/terms` }) },
    },
    locale: stripeLocale(r.t.locale),
  });
  if (!session.url) throw new StripeError(502, null, "Checkout came back without an address");
  return session.url;
}

/** Stripe's page for changing a card, seeing receipts, switching plans or cancelling; its address. */
export async function createPortal(config: StripeConfig, customerId: string, returnUrl: string, locale: Locale): Promise<string> {
  const session = await stripe<{ url: string }>(config, "POST", "/v1/billing_portal/sessions", { customer: customerId, return_url: returnUrl, locale: stripeLocale(locale) });
  return session.url;
}

export type StripeSubscription = {
  id: string;
  livemode: boolean;
  customer: string;
  status: string;
  created: number;
  trial_end: number | null;
  cancel_at: number | null;
  cancel_at_period_end: boolean;
  ended_at: number | null;
  metadata: Record<string, string>;
  items: { data: { current_period_end: number; price: StripePrice }[] };
};

/** A subscription as Stripe has it now, or null when Stripe has no such subscription. */
export async function readSubscription(config: StripeConfig, id: string): Promise<StripeSubscription | null> {
  if (!/^sub_[A-Za-z0-9]{1,100}$/.test(id)) return null;
  try {
    return await stripe<StripeSubscription>(config, "GET", `/v1/subscriptions/${id}`);
  } catch (e) {
    if (e instanceof StripeError && e.status === 404) return null;
    throw e;
  }
}

export type StripeCheckoutSession = { id: string; client_reference_id: string | null; subscription: string | null; status: string | null };

/** A finished Checkout, to record its subscription the moment the person is back (before Stripe's webhook, if it's slower). */
export async function readCheckout(config: StripeConfig, id: string): Promise<StripeCheckoutSession | null> {
  if (!/^cs_(test|live)_[A-Za-z0-9]{1,200}$/.test(id)) return null;
  try {
    return await stripe<StripeCheckoutSession>(config, "GET", `/v1/checkout/sessions/${id}`);
  } catch (e) {
    if (e instanceof StripeError && e.status === 404) return null;
    throw e;
  }
}

/** Deleting an account: Stripe deletes the customer, which cancels their subscription at once and forgets their card. Gone already counts as done. */
export async function deleteCustomer(config: StripeConfig, customerId: string): Promise<void> {
  try {
    await stripe(config, "DELETE", `/v1/customers/${customerId}`);
  } catch (e) {
    if (e instanceof StripeError && e.status === 404) return;
    throw e;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATUSES = new Set(["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"]);

export type SubscriptionRecord = {
  userId: string;
  livemode: boolean;
  customerId: string;
  subscriptionId: string;
  created: string;
  plan: PlanId;
  interval: Interval;
  status: string;
  periodEnd: string | null;
  trialEnd: string | null;
  endsAt: string | null;
};

const iso = (seconds: number | null | undefined): string | null => (typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null);

/**
 * What Prism keeps of a subscription, or why it can't: whose it is (the
 * metadata Checkout gave it; `fallbackUser` only from the Checkout that made
 * it), and the plan its price's lookup key names.
 */
export function subscriptionRecord(sub: StripeSubscription, fallbackUser?: string | null): SubscriptionRecord | { problem: "no-person" | "unknown-price" | "malformed" } {
  const userId = sub.metadata?.prism_user ?? fallbackUser ?? "";
  if (!UUID.test(userId)) return { problem: "no-person" };
  const items = sub.items?.data ?? [];
  const named = items.map((i) => planOfLookupKey(i.price?.lookup_key)).find(Boolean);
  if (!named) return { problem: "unknown-price" };
  if (!/^cus_[A-Za-z0-9]{1,100}$/.test(sub.customer) || !/^sub_[A-Za-z0-9]{1,100}$/.test(sub.id) || !STATUSES.has(sub.status) || !iso(sub.created)) {
    return { problem: "malformed" };
  }
  const ends = items.map((i) => i.current_period_end).filter((n) => Number.isFinite(n));
  const periodEnd = ends.length ? iso(Math.max(...ends)) : null;
  const endsAt = sub.status === "canceled" ? (iso(sub.ended_at) ?? periodEnd) : (iso(sub.cancel_at) ?? (sub.cancel_at_period_end ? periodEnd : null));
  return {
    userId,
    livemode: sub.livemode,
    customerId: sub.customer,
    subscriptionId: sub.id,
    created: iso(sub.created)!,
    plan: named.plan,
    interval: named.interval,
    status: sub.status,
    periodEnd,
    trialEnd: iso(sub.trial_end),
    endsAt,
  };
}

/** How far a webhook's timestamp may be from now (Stripe's own default), so a recorded request can't be replayed later. */
export const SIGNATURE_TOLERANCE_S = 300;

/**
 * Whether Stripe signed exactly these bytes: an HMAC-SHA256 of "timestamp.body"
 * under the endpoint's signing secret, in the `Stripe-Signature` header (any
 * `v1` may match, since Stripe signs with both secrets while one is rolled).
 */
export function verifyStripeSignature(secret: string, header: string | null, raw: Uint8Array, now = Date.now()): boolean {
  if (!header || header.length > 2000) return false;
  let at = NaN;
  const signatures: Buffer[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    const [k, v] = [part.slice(0, eq).trim(), part.slice(eq + 1).trim()];
    if (k === "t" && /^\d{1,12}$/.test(v)) at = Number(v);
    else if (k === "v1" && /^[0-9a-f]{64}$/.test(v)) signatures.push(Buffer.from(v, "hex"));
  }
  if (!Number.isFinite(at) || signatures.length === 0 || Math.abs(now / 1000 - at) > SIGNATURE_TOLERANCE_S) return false;
  const expected = createHmac("sha256", secret).update(`${at}.`).update(raw).digest();
  return signatures.some((s) => s.length === expected.length && timingSafeEqual(s, expected));
}

export type StripeEvent = { id: string; type: string; livemode: boolean; created: number; data: { object: Record<string, unknown> } };

/** The subscription an event is about, and whose (a Checkout's own reference), or null for an event Prism doesn't act on. */
export function subscriptionOf(event: StripeEvent): { id: string; user: string | null } | null {
  const o = event.data?.object ?? {};
  if (event.type === "checkout.session.completed") {
    return o.mode === "subscription" && typeof o.subscription === "string"
      ? { id: o.subscription, user: typeof o.client_reference_id === "string" ? o.client_reference_id : null }
      : null;
  }
  if (event.type.startsWith("customer.subscription.") && typeof o.id === "string") return { id: o.id, user: null };
  return null;
}
