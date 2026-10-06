// Stripe's webhook as Stripe meets it: believed only when signed, and even
// then only as a name — the subscription it names is read back from Stripe
// and kept through the one database door, with the job's secret.

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOOKUP_KEYS } from "./plans";

vi.mock("server-only", () => ({}));
const rpc = vi.fn(async (..._args: unknown[]) => ({ data: "recorded" as unknown, error: null as { code: string } | null }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));

const { POST } = await import("@/app/api/stripe/webhook/route");

const WHSEC = "whsec_" + "w".repeat(32);
const JOB = "c".repeat(44);
const USER = "11111111-2222-4333-8444-555555555555";

function post(event: unknown, { secret = WHSEC, at = Math.floor(Date.now() / 1000) } = {}) {
  const body = JSON.stringify(event);
  const sig = `t=${at},v1=${createHmac("sha256", secret).update(`${at}.${body}`).digest("hex")}`;
  return POST(new Request("https://prism.example/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": sig }, body }));
}

const event = (type: string, object: Record<string, unknown>, livemode = false) => ({ id: "evt_1", type, livemode, created: 1, data: { object } });

const subscription = {
  id: "sub_ABC",
  livemode: false,
  customer: "cus_XYZ",
  status: "active",
  created: 1_790_000_000,
  trial_end: null,
  cancel_at: null,
  cancel_at_period_end: false,
  ended_at: null,
  metadata: { prism_user: USER },
  items: { data: [{ current_period_end: 1_792_592_000, price: { id: "price_1", active: true, lookup_key: LOOKUP_KEYS.plus.month, currency: "usd", unit_amount: 599, recurring: { interval: "month", interval_count: 1 } } }] },
};

describe("Stripe's webhook", () => {
  let stripe: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_" + "k".repeat(24));
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", WHSEC);
    vi.stubEnv("CRON_SECRET", JOB);
    rpc.mockClear();
    rpc.mockResolvedValue({ data: "recorded", error: null });
    stripe = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(subscription));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads the subscription it names back from Stripe, and keeps that, with the job's secret", async () => {
    // Even an event claiming the subscription was cancelled keeps what Stripe says now.
    const res = await post(event("customer.subscription.deleted", { id: "sub_ABC", status: "canceled" }));
    expect(res.status).toBe(200);
    expect(String(stripe.mock.calls[0]![0])).toBe("https://api.stripe.com/v1/subscriptions/sub_ABC");
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("billing_record");
    expect(args).toMatchObject({
      p_secret: JOB,
      p_user_id: USER,
      p_livemode: false,
      p_customer_id: "cus_XYZ",
      p_subscription_id: "sub_ABC",
      p_plan: "plus",
      p_interval: "month",
      p_status: "active",
      p_period_end: new Date(1_792_592_000_000).toISOString(),
      p_ends_at: null,
    });
  });

  it("takes a finished Checkout's subscription, and whose it is", async () => {
    stripe.mockImplementation(async () => Response.json({ ...subscription, metadata: {} }));
    await post(event("checkout.session.completed", { mode: "subscription", subscription: "sub_ABC", client_reference_id: USER }));
    expect(rpc).toHaveBeenCalledWith("billing_record", expect.objectContaining({ p_user_id: USER }));
  });

  it("does nothing at all with an unsigned, wrongly signed or replayed event", async () => {
    for (const res of [
      await POST(new Request("https://prism.example/api/stripe/webhook", { method: "POST", body: JSON.stringify(event("customer.subscription.updated", { id: "sub_ABC" })) })),
      await post(event("customer.subscription.updated", { id: "sub_ABC" }), { secret: "whsec_" + "x".repeat(32) }),
      await post(event("customer.subscription.updated", { id: "sub_ABC" }), { at: Math.floor(Date.now() / 1000) - 3600 }),
    ]) {
      expect(res.status).toBe(401);
    }
    expect(stripe).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("acknowledges what it doesn't act on: other events, the other Stripe mode, subscriptions that aren't Prism's", async () => {
    expect((await post(event("invoice.paid", { id: "in_1" }))).status).toBe(200);
    expect((await post(event("customer.subscription.updated", { id: "sub_ABC" }, true))).status).toBe(200);
    expect(stripe).not.toHaveBeenCalled();
    stripe.mockImplementation(async () => Response.json({ ...subscription, metadata: {} }));
    expect((await post(event("customer.subscription.updated", { id: "sub_ABC" }))).status).toBe(200);
    stripe.mockImplementation(async () => Response.json({ error: { message: "No such subscription" } }, { status: 404 }));
    expect((await post(event("customer.subscription.updated", { id: "sub_GONE" }))).status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks Stripe to send it again when Stripe or the database couldn't answer", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect((await post(event("customer.subscription.updated", { id: "sub_ABC" }))).status).toBe(500);
    stripe.mockImplementation(async () => Response.json({ error: { message: "down" } }, { status: 503 }));
    expect((await post(event("customer.subscription.updated", { id: "sub_ABC" }))).status).toBe(500);
    // Never a customer or a person in the log.
    expect(log.mock.calls.flat().join(" ")).not.toMatch(/cus_|11111111/);
  });

  it("isn't there at all while billing is off", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect((await post(event("customer.subscription.updated", { id: "sub_ABC" }))).status).toBe(404);
  });
});
