// The gates, as someone on the free plan meets them once billing is on: one
// bank links, a second (or an investment account, or Coinbase) is refused
// before Plaid or Coinbase is asked for anything, and someone with Prism Plus
// is never refused. Every refusal names what was asked for, so the button can
// say why on the pricing page.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "prism.bis-rgv.com", "x-forwarded-proto": "https" }),
}));

/** A signed-in person, as the database answers them: their plan (my_plan) and how many banks they've linked. */
const person = { plus: false, banks: 0, countFails: false };
const fakeAccount = {
  userId: "11111111-2222-4333-8444-555555555555",
  email: "a@x.test",
  supabase: {
    rpc: async (fn: string) =>
      fn === "my_plan"
        ? { data: [{ plan: null, billing_interval: null, status: null, period_end: null, trial_end: null, ends_at: null, customer_id: null, subscription_id: null, own_plus: person.plus, household_plan: false, household_plus: false, subscribed_before: false }], error: null }
        : { data: null, error: { code: "42883" } },
    from: () => ({ select: () => ({ eq: async () => (person.countFails ? { count: null, error: { code: "57014" } } : { count: person.banks, error: null }) }) }),
  },
};
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => fakeAccount }));
vi.mock("@/lib/server/account-store", () => ({ loadAccount: async () => ({ items: [] }), addAccountPlaidItem: async () => undefined }));

const { connectionNeedsPlus } = await import("./plus");
const { POST: linkToken } = await import("@/app/api/plaid/link-token/route");
const { POST: exchange } = await import("@/app/api/plaid/exchange/route");
const { GET: coinbaseConnect } = await import("@/app/api/coinbase/connect/route");

const SITE = "https://prism.bis-rgv.com";
const post = (route: (req: Request) => Promise<Response>, path: string, body: unknown) =>
  route(new Request(`${SITE}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: SITE, host: "prism.bis-rgv.com" }, body: JSON.stringify(body) }));

const plaid = vi.fn(async (url: RequestInfo | URL) => {
  const path = new URL(String(url)).pathname;
  if (path === "/link/token/create") return Response.json({ link_token: "link-sandbox-1", expiration: "2026-10-06T23:00:00Z" });
  if (path === "/item/public_token/exchange") return Response.json({ access_token: "access-sandbox-1", item_id: "item-1" });
  if (path === "/accounts/get") return Response.json({ accounts: [], item: { institution_id: null } });
  return Response.json({ error_code: "NOT_FOUND" }, { status: 404 });
});

describe("with billing on, the free plan", () => {
  beforeEach(() => {
    Object.assign(person, { plus: false, banks: 0, countFails: false });
    plaid.mockClear();
    vi.stubGlobal("fetch", plaid);
    vi.stubEnv("PLAID_CLIENT_ID", "id");
    vi.stubEnv("PLAID_SECRET", "secret");
    vi.stubEnv("PRISM_VAULT_KEY", Buffer.alloc(32, 7).toString("base64url"));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_" + "k".repeat(24));
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_" + "w".repeat(32));
    vi.stubEnv("CRON_SECRET", "c".repeat(44));
    vi.stubEnv("COINBASE_CLIENT_ID", "cb-id");
    vi.stubEnv("COINBASE_CLIENT_SECRET", "cb-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps one bank: the first links, a second, an investment account or Coinbase needs Prism Plus", async () => {
    const account = fakeAccount as never;
    expect(await connectionNeedsPlus(account, "bank")).toBeNull();
    expect(await connectionNeedsPlus(account, "investments")).toBe("investments");
    expect(await connectionNeedsPlus(account, "coinbase")).toBe("coinbase");
    person.banks = 1;
    expect(await connectionNeedsPlus(account, "bank")).toBe("banks");
    // A count that can't be read errs toward the person.
    person.countFails = true;
    expect(await connectionNeedsPlus(account, "bank")).toBeNull();
    // Prism Plus: everything.
    Object.assign(person, { plus: true, banks: 5, countFails: false });
    for (const kind of ["bank", "investments", "coinbase"] as const) expect(await connectionNeedsPlus(account, kind)).toBeNull();
  });

  it("refuses a second bank before Link opens, and before a token is exchanged, saying what it needs", async () => {
    person.banks = 1;
    const opened = await post(linkToken, "/api/plaid/link-token", { from: "/connections" });
    expect(opened.status).toBe(402);
    expect(await opened.json()).toMatchObject({ error: "plus_required", need: "banks", message: "Connecting more than one bank comes with Prism Plus." });
    const investments = await post(linkToken, "/api/plaid/link-token", { from: "/connections", kind: "investments" });
    expect(await investments.json()).toMatchObject({ error: "plus_required", need: "investments" });
    const saved = await post(exchange, "/api/plaid/exchange", { publicToken: "public-sandbox-abc" });
    expect(saved.status).toBe(402);
    expect(plaid).not.toHaveBeenCalled();
  });

  it("lets the first bank through, and someone with Prism Plus through every time", async () => {
    expect((await post(linkToken, "/api/plaid/link-token", { from: "/connections" })).status).toBe(200);
    Object.assign(person, { plus: true, banks: 3 });
    expect((await post(linkToken, "/api/plaid/link-token", { from: "/connections", kind: "investments" })).status).toBe(200);
    expect((await post(exchange, "/api/plaid/exchange", { publicToken: "public-sandbox-abc" })).status).toBe(200);
  });

  it("sends someone without it from Coinbase's button to the pricing page, before Coinbase is asked for anything", async () => {
    const { NextRequest } = await import("next/server");
    const res = await coinbaseConnect(new NextRequest(`${SITE}/api/coinbase/connect`));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${SITE}/pricing?need=coinbase`);
    person.plus = true;
    const allowed = await coinbaseConnect(new NextRequest(`${SITE}/api/coinbase/connect`));
    expect(allowed.headers.get("location")).toMatch(/coinbase\.com/);
  });
});
