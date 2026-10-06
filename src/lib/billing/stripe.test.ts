// Stripe, as Prism meets it: a webhook believed only with Stripe's signature
// over the exact bytes, a subscription read into exactly what Prism keeps,
// and a price sold only when it's the one the pricing page shows.

import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EN, translate } from "@/lib/i18n/t";
import { ES } from "@/lib/i18n/es";
import { LOOKUP_KEYS, PRICES } from "./plans";
import type { StripePrice, StripeSubscription } from "./stripe";

vi.mock("server-only", () => ({}));

const { createCheckout, formEncode, priceProblem, renewalNote, sellingPrices, stripeConfig, subscriptionOf, subscriptionRecord, verifyStripeSignature } = await import("./stripe");

const SECRET = "whsec_" + "a".repeat(32);
const USER = "11111111-2222-4333-8444-555555555555";
const env = { STRIPE_SECRET_KEY: "sk_test_" + "k".repeat(24), STRIPE_WEBHOOK_SECRET: SECRET, CRON_SECRET: "c".repeat(44) };
const config = stripeConfig(env)!;

function signed(body: string, at = Math.floor(Date.now() / 1000), secret = SECRET) {
  return `t=${at},v1=${createHmac("sha256", secret).update(`${at}.${body}`).digest("hex")}`;
}
const bytes = (s: string) => new TextEncoder().encode(s);

function price(over: Partial<StripePrice> = {}): StripePrice {
  return { id: "price_1", active: true, lookup_key: LOOKUP_KEYS.plus.month, currency: "usd", unit_amount: PRICES.plus.month, recurring: { interval: "month", interval_count: 1 }, ...over };
}

function subscription(over: Partial<StripeSubscription> = {}): StripeSubscription {
  return {
    id: "sub_ABC123",
    livemode: false,
    customer: "cus_XYZ789",
    status: "trialing",
    created: 1_790_000_000,
    trial_end: 1_791_209_600,
    cancel_at: null,
    cancel_at_period_end: false,
    ended_at: null,
    metadata: { prism_user: USER },
    items: { data: [{ current_period_end: 1_791_209_600, price: price() }] },
    ...over,
  };
}

describe("billing's switch", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is on only with all three secrets in their expected forms, and knows test keys from live ones", () => {
    expect(stripeConfig({})).toBeNull();
    expect(config).toMatchObject({ livemode: false, jobSecret: env.CRON_SECRET });
    expect(stripeConfig({ ...env, STRIPE_SECRET_KEY: "rk_live_" + "k".repeat(24) })?.livemode).toBe(true);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const broken of [{ CRON_SECRET: "" }, { CRON_SECRET: "short" }, { STRIPE_WEBHOOK_SECRET: "" }, { STRIPE_SECRET_KEY: "pk_live_" + "k".repeat(24) }, { STRIPE_WEBHOOK_SECRET: "secret" }]) {
      expect(stripeConfig({ ...env, ...broken }), JSON.stringify(broken)).toBeNull();
    }
    // Said once, by the setting's name: never its value.
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0])).not.toContain("kkkk");
  });
});

describe("a webhook's signature", () => {
  const body = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated" });

  it("holds for the exact bytes Stripe signed, under the endpoint's secret, within five minutes", () => {
    expect(verifyStripeSignature(SECRET, signed(body), bytes(body))).toBe(true);
    expect(verifyStripeSignature(SECRET, signed(body), bytes(body.replace("updated", "deleted")))).toBe(false);
    expect(verifyStripeSignature(SECRET, signed(body, undefined, "whsec_" + "b".repeat(32)), bytes(body))).toBe(false);
    const old = Math.floor(Date.now() / 1000) - 301;
    expect(verifyStripeSignature(SECRET, signed(body, old), bytes(body))).toBe(false);
    expect(verifyStripeSignature(SECRET, signed(body, Math.floor(Date.now() / 1000) + 400), bytes(body))).toBe(false);
  });

  it("accepts either secret while one is being rolled, and refuses a header that isn't one", () => {
    const at = Math.floor(Date.now() / 1000);
    const other = createHmac("sha256", "whsec_other").update(`${at}.${body}`).digest("hex");
    const mine = createHmac("sha256", SECRET).update(`${at}.${body}`).digest("hex");
    expect(verifyStripeSignature(SECRET, `t=${at},v1=${other},v1=${mine}`, bytes(body))).toBe(true);
    for (const header of [null, "", `t=${at}`, `v1=${mine}`, `t=abc,v1=${mine}`, `t=${at},v0=${mine}`, `t=${at},v1=${mine.slice(2)}`, `t=${at},v1=${mine}`.padEnd(2001, "x")]) {
      expect(verifyStripeSignature(SECRET, header, bytes(body)), String(header).slice(0, 40)).toBe(false);
    }
  });
});

describe("an event", () => {
  const event = (type: string, object: Record<string, unknown>) => ({ id: "evt_1", type, livemode: false, created: 0, data: { object } });

  it("names the subscription it's about, and whose for a finished Checkout", () => {
    expect(subscriptionOf(event("checkout.session.completed", { mode: "subscription", subscription: "sub_1", client_reference_id: USER }))).toEqual({ id: "sub_1", user: USER });
    expect(subscriptionOf(event("customer.subscription.deleted", { id: "sub_2" }))).toEqual({ id: "sub_2", user: null });
    expect(subscriptionOf(event("checkout.session.completed", { mode: "payment" }))).toBeNull();
    expect(subscriptionOf(event("invoice.paid", { id: "in_1" }))).toBeNull();
  });
});

describe("a subscription, as Prism keeps it", () => {
  it("is whose its metadata says, on the plan its price's lookup key names", () => {
    expect(subscriptionRecord(subscription())).toEqual({
      userId: USER,
      livemode: false,
      customerId: "cus_XYZ789",
      subscriptionId: "sub_ABC123",
      created: new Date(1_790_000_000_000).toISOString(),
      plan: "plus",
      interval: "month",
      status: "trialing",
      periodEnd: new Date(1_791_209_600_000).toISOString(),
      trialEnd: new Date(1_791_209_600_000).toISOString(),
      endsAt: null,
    });
    const household = subscription({ items: { data: [{ current_period_end: 1_800_000_000, price: price({ lookup_key: LOOKUP_KEYS.household.year }) }] } });
    expect(subscriptionRecord(household)).toMatchObject({ plan: "household", interval: "year" });
  });

  it("says when it stops once cancelled, at the period's end or on a date", () => {
    expect(subscriptionRecord(subscription({ status: "active", cancel_at_period_end: true }))).toMatchObject({ endsAt: new Date(1_791_209_600_000).toISOString() });
    expect(subscriptionRecord(subscription({ status: "active", cancel_at: 1_795_000_000 }))).toMatchObject({ endsAt: new Date(1_795_000_000_000).toISOString() });
    expect(subscriptionRecord(subscription({ status: "canceled", ended_at: 1_790_500_000 }))).toMatchObject({ status: "canceled", endsAt: new Date(1_790_500_000_000).toISOString() });
  });

  it("isn't Prism's to keep without a person, or on a price Prism doesn't sell", () => {
    expect(subscriptionRecord(subscription({ metadata: {} }))).toEqual({ problem: "no-person" });
    expect(subscriptionRecord(subscription({ metadata: {} }), USER)).toMatchObject({ userId: USER });
    expect(subscriptionRecord(subscription({ metadata: { prism_user: "not-a-uuid" } }))).toEqual({ problem: "no-person" });
    expect(subscriptionRecord(subscription({ items: { data: [{ current_period_end: 1, price: price({ lookup_key: "someone_elses_plan" }) }] } }))).toEqual({ problem: "unknown-price" });
    expect(subscriptionRecord(subscription({ status: "frozen" }))).toEqual({ problem: "malformed" });
    expect(subscriptionRecord(subscription({ customer: "someone" }))).toEqual({ problem: "malformed" });
  });
});

describe("a price", () => {
  it("is sold only when it's exactly what the pricing page shows", () => {
    expect(priceProblem(price(), "plus", "month")).toBeNull();
    expect(priceProblem(undefined, "plus", "month")).toMatch(/prism_plus_monthly/);
    expect(priceProblem(price({ unit_amount: 699 }), "plus", "month")).toMatch(/699/);
    expect(priceProblem(price({ currency: "eur" }), "plus", "month")).toMatch(/eur/);
    expect(priceProblem(price({ active: false }), "plus", "month")).toMatch(/archived/);
    expect(priceProblem(price({ recurring: { interval: "year", interval_count: 1 } }), "plus", "month")).toMatch(/renew/);
    expect(priceProblem(price({ recurring: { interval: "month", interval_count: 3 } }), "plus", "month")).toMatch(/renew/);
    expect(priceProblem(price(), "household", "month")).not.toBeNull();
  });

  it("is read from Stripe by lookup key, with the API version pinned, and kept a few minutes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: [price(), price({ id: "price_2", lookup_key: LOOKUP_KEYS.household.year })] }));
    const prices = await sellingPrices(config, 1_000);
    expect(prices.get(LOOKUP_KEYS.household.year)?.id).toBe("price_2");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/^https:\/\/api\.stripe\.com\/v1\/prices\?/);
    expect(decodeURIComponent(String(url))).toContain("lookup_keys[0]=prism_plus_monthly");
    expect((init!.headers as Record<string, string>)["Stripe-Version"]).toMatch(/^\d{4}-\d{2}-\d{2}\./);
    await sellingPrices(config, 2_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});

describe("Checkout", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is one subscription for the person, with the free days only when theirs, tax, the Terms ticked, and the renewal said beside the button", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_1" }));
    const t = translate("es", ES);
    const url = await createCheckout(config, { userId: USER, email: "a@x.test", customerId: null, plan: "plus", interval: "year", priceId: "price_9", trial: true, origin: "https://prism.example", t });
    expect(url).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
    const body = new URLSearchParams(String(fetchMock.mock.calls[0]![1]!.body));
    expect(Object.fromEntries(body)).toMatchObject({
      mode: "subscription",
      "line_items[0][price]": "price_9",
      "line_items[0][quantity]": "1",
      client_reference_id: USER,
      customer_email: "a@x.test",
      "subscription_data[metadata][prism_user]": USER,
      "subscription_data[trial_period_days]": "14",
      "automatic_tax[enabled]": "true",
      "consent_collection[terms_of_service]": "required",
      locale: "es-419",
      success_url: "https://prism.example/api/stripe/return?session={CHECKOUT_SESSION_ID}",
      cancel_url: "https://prism.example/pricing",
    });
    expect(body.get("custom_text[submit][message]")).toContain("$49 al año");
    expect(body.get("custom_text[terms_of_service_acceptance][message]")).toContain("(https://prism.example/terms)");

    fetchMock.mockClear();
    await createCheckout(config, { userId: USER, email: "a@x.test", customerId: "cus_1", plan: "household", interval: "month", priceId: "price_8", trial: false, origin: "https://prism.example", t: EN });
    const again = new URLSearchParams(String(fetchMock.mock.calls[0]![1]!.body));
    expect(again.get("customer")).toBe("cus_1");
    expect(again.get("customer_update[address]")).toBe("auto");
    expect(again.has("customer_email")).toBe(false);
    expect(again.has("subscription_data[trial_period_days]")).toBe(false);
    expect(again.get("locale")).toBe("en");
  });

  it("says what renews, for how much and how to stop it, with or without free days", () => {
    expect(renewalNote("plus", "month", true, EN)).toBe(
      "Prism Plus renews automatically at $5.99 a month, plus any sales tax, until you cancel. Your first 14 days are free: cancel before they end, on your Account page in Prism, and you won't be charged.",
    );
    expect(renewalNote("household", "year", false, EN)).toMatch(/^Prism Plus for your household renews automatically at \$79 a year.*you keep Prism Plus until the end/);
  });
});

describe("Stripe's form encoding", () => {
  it("nests objects and lists the way Stripe reads them, leaving empty values out", () => {
    expect(decodeURIComponent(formEncode({ a: 1, b: { c: "x", d: null }, e: [{ f: true }], g: undefined }))).toBe("a=1&b[c]=x&e[0][f]=true");
  });
});
