// The two Plaid routes a bank redirect passes through, as the browser meets
// them: /api/plaid/link-token remembers the Link token (and where the person
// started) only when Plaid may send them back, and /api/plaid/exchange forgets
// it once the bank is linked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VAULT_COOKIE } from "@/lib/server/vault";
import { readReturn, RETURN_COOKIE } from "./return";

vi.mock("server-only", () => ({}));

type Jar = Map<string, { value: string; options?: Record<string, unknown> }>;
const jar: Jar = new Map();
const cleared = new Map<string, Record<string, unknown>>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    has: (name: string) => jar.has(name),
    // As a browser would: a cookie set with maxAge 0 is gone. `cleared` keeps how it was cleared, for __Host- rules.
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      if (options?.maxAge === 0) {
        jar.delete(name);
        cleared.set(name, options);
      } else jar.set(name, { value, options });
    },
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ host: "prism.bis-rgv.com", "x-forwarded-proto": "https" }),
}));
const signedIn = { current: null as null | { userId: string; email: string } };
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => signedIn.current }));
const addAccountPlaidItem = vi.fn(async () => undefined);
/** The banks the signed-in account holds, as loadAccount returns them. */
const accountItems = { current: [] as { itemId: string; accessToken: string; institutionId: string | null; institutionName: string | null; linkedAt: string }[] };
vi.mock("@/lib/server/account-store", () => ({ loadAccount: async () => ({ items: accountItems.current }), addAccountPlaidItem: (...a: unknown[]) => addAccountPlaidItem(...(a as [])) }));

const { POST: linkToken } = await import("@/app/api/plaid/link-token/route");
const { POST: exchange } = await import("@/app/api/plaid/exchange/route");

const SITE = "https://prism.bis-rgv.com";
const post = (route: (req: Request) => Promise<Response>, path: string, body: unknown) =>
  route(new Request(`${SITE}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: SITE, host: "prism.bis-rgv.com" }, body: JSON.stringify(body) }));

/** Plaid, as far as these two routes talk to it. `allowList` is the dashboard's Allowed redirect URIs. */
let allowList: string[] = [];
const plaid = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(url)).pathname;
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  if (path === "/link/token/create" && body.redirect_uri !== undefined && !allowList.includes(String(body.redirect_uri))) {
    return Response.json({ error_code: "INVALID_FIELD", error_message: "OAuth redirect URI must be configured in the developer dashboard." }, { status: 400 });
  }
  if (path === "/link/token/create") return Response.json({ link_token: "link-sandbox-4f1e", expiration: "2026-09-28T23:00:00Z", _sent: body });
  if (path === "/item/public_token/exchange") return Response.json({ access_token: "access-sandbox-1", item_id: "item-1" });
  if (path === "/accounts/get") return Response.json({ accounts: [], item: { institution_id: "ins_127287" } });
  if (path === "/institutions/get_by_id") return Response.json({ institution: { name: "Platypus OAuth Bank" } });
  return Response.json({ error_code: "NOT_FOUND" }, { status: 404 });
});
const sentToPlaid = () => plaid.mock.calls.filter(([u]) => String(u).endsWith("/link/token/create")).map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

describe("a bank that signs people in on its own website", () => {
  beforeEach(() => {
    jar.clear();
    cleared.clear();
    signedIn.current = null;
    allowList = [`${SITE}/connections/return`];
    addAccountPlaidItem.mockClear();
    plaid.mockClear();
    vi.stubGlobal("fetch", plaid);
    vi.stubEnv("PLAID_CLIENT_ID", "id");
    vi.stubEnv("PLAID_SECRET", "secret");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("gets Prism's return page, and Prism keeps the Link token and the page the person started on", async () => {
    vi.stubEnv("PLAID_REDIRECT_URI", `${SITE}/connections/return`);
    const res = await post(linkToken, "/api/plaid/link-token", { from: "/budgets" });
    expect(res.status).toBe(200);
    expect(sentToPlaid()[0]!.redirect_uri).toBe(`${SITE}/connections/return`);
    const saved = jar.get(RETURN_COOKIE)!;
    expect(readReturn(saved.value)).toEqual({ linkToken: "link-sandbox-4f1e", back: "/budgets", reconnect: null });
    expect(saved.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 3600 });
  });

  it("sends nothing and remembers nothing until the operator sets the return address — and drops an older one", async () => {
    jar.set(RETURN_COOKIE, { value: "stale" });
    await post(linkToken, "/api/plaid/link-token", { from: "/budgets" });
    expect(sentToPlaid()[0]).not.toHaveProperty("redirect_uri");
    expect(jar.has(RETURN_COOKIE)).toBe(false);
  });

  it("leaves a mistyped return address out, and says why in the logs, rather than break every connection", async () => {
    vi.stubEnv("PLAID_REDIRECT_URI", `${SITE}/connections/return/`);
    const res = await post(linkToken, "/api/plaid/link-token", {});
    expect(res.status).toBe(200);
    expect(sentToPlaid()[0]).not.toHaveProperty("redirect_uri");
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/PLAID_REDIRECT_URI must be exactly https:\/\/prism\.bis-rgv\.com\/connections\/return/));
  });

  it("goes back to Connections when the starting page isn't a page on this site", async () => {
    vi.stubEnv("PLAID_REDIRECT_URI", `${SITE}/connections/return`);
    await post(linkToken, "/api/plaid/link-token", { from: "https://evil.example/" });
    expect(readReturn(jar.get(RETURN_COOKIE)!.value)?.back).toBe("/connections");
  });

  it("is left out, and linking still works, when Plaid hasn't allow-listed it yet — with the reason in the logs", async () => {
    vi.stubEnv("PLAID_REDIRECT_URI", `${SITE}/connections/return`);
    allowList = [];
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await post(linkToken, "/api/plaid/link-token", { from: "/budgets" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ linkToken: "link-sandbox-4f1e" });
    expect(sentToPlaid().map((b) => b.redirect_uri)).toEqual([`${SITE}/connections/return`, undefined]);
    // Nothing Plaid will send back to, so nothing kept.
    expect(jar.has(RETURN_COOKIE)).toBe(false);
    expect(errors).toHaveBeenCalledWith(expect.stringMatching(/Allowed redirect URIs/));
  });

  it("doesn't paper over other refusals: bad keys still fail loudly", async () => {
    vi.stubEnv("PLAID_REDIRECT_URI", `${SITE}/connections/return`);
    plaid.mockImplementationOnce(async () => Response.json({ error_code: "INVALID_API_KEYS", error_message: "bad keys" }, { status: 400 }));
    const res = await post(linkToken, "/api/plaid/link-token", {});
    expect(res.status).toBe(502);
    expect(sentToPlaid()).toHaveLength(1);
  });

  it("logs why Plaid refused, and tells the person in plain words", async () => {
    // What production's Link said before its customization had a use case.
    plaid.mockImplementationOnce(async () =>
      Response.json({ error_code: "INVALID_LINK_CUSTOMIZATION", error_message: "link customization is missing a use case", display_message: null }, { status: 400 }),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await post(linkToken, "/api/plaid/link-token", {});
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "plaid_error", message: "Plaid couldn't start the connection. Try again in a minute. (Plaid code: INVALID_LINK_CUSTOMIZATION)" });
    expect(errors).toHaveBeenCalledWith(expect.stringMatching(/^Plaid Link could not start: .*INVALID_LINK_CUSTOMIZATION link customization is missing a use case$/));
    // Plaid's own words for the person win when it sends them.
    plaid.mockImplementationOnce(async () => Response.json({ error_code: "INSTITUTION_DOWN", display_message: "This bank is down for maintenance." }, { status: 400 }));
    expect(await (await post(linkToken, "/api/plaid/link-token", {})).json()).toMatchObject({ message: "This bank is down for maintenance." });
  });

  it("is forgotten, the __Host- way, when a bank is linked to a signed-in account", async () => {
    vi.stubEnv("PLAID_REDIRECT_URI", `${SITE}/connections/return`);
    signedIn.current = { userId: "u1", email: "a@x.test" };
    await post(linkToken, "/api/plaid/link-token", { from: "/" });
    expect(jar.has(RETURN_COOKIE)).toBe(true);
    const res = await post(exchange, "/api/plaid/exchange", { publicToken: "public-sandbox-77aa" });
    expect(res.status).toBe(200);
    expect(addAccountPlaidItem).toHaveBeenCalledTimes(1);
    expect(jar.has(RETURN_COOKIE)).toBe(false);
    expect(cleared.get(RETURN_COOKIE)).toMatchObject({ secure: true, path: "/", maxAge: 0 });
  });

  it("is forgotten once the bank is linked", async () => {
    vi.stubEnv("PLAID_REDIRECT_URI", `${SITE}/connections/return`);
    await post(linkToken, "/api/plaid/link-token", { from: "/" });
    expect(jar.has(RETURN_COOKIE)).toBe(true);
    const res = await post(exchange, "/api/plaid/exchange", { publicToken: "public-sandbox-77aa" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, institutionName: "Platypus OAuth Bank" });
    expect(jar.has(RETURN_COOKIE)).toBe(false);
  });
});

// Who may connect a bank at all (src/lib/linking.ts). With accounts on, a signed-out
// request gets nowhere near Plaid and leaves nothing in the browser.
describe("connecting a bank needs an account", () => {
  const vaultSet = () => jar.has(VAULT_COOKIE);
  beforeEach(() => {
    jar.clear();
    cleared.clear();
    signedIn.current = null;
    allowList = [];
    addAccountPlaidItem.mockClear();
    plaid.mockClear();
    vi.stubGlobal("fetch", plaid);
    vi.stubEnv("PLAID_CLIENT_ID", "id");
    vi.stubEnv("PLAID_SECRET", "secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const accountsOn = () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  };

  it("refuses to open Link for someone signed out, before Plaid is asked for anything", async () => {
    accountsOn();
    const res = await post(linkToken, "/api/plaid/link-token", { from: "/budgets" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "sign_in_required" });
    expect(plaid).not.toHaveBeenCalled();
    expect(vaultSet()).toBe(false);
  });

  it("refuses to save a bank for someone signed out, even holding a genuine public token", async () => {
    accountsOn();
    const res = await post(exchange, "/api/plaid/exchange", { publicToken: "public-sandbox-77aa" });
    expect(res.status).toBe(401);
    expect(plaid).not.toHaveBeenCalled();
    expect(vaultSet()).toBe(false);
    expect(addAccountPlaidItem).not.toHaveBeenCalled();
  });

  it("links a signed-in account's bank into the account, never into a cookie", async () => {
    accountsOn();
    signedIn.current = { userId: "u1", email: "a@x.test" };
    expect((await post(linkToken, "/api/plaid/link-token", { from: "/" })).status).toBe(200);
    expect(sentToPlaid()[0]!.user).toEqual({ client_user_id: "u1" });
    expect((await post(exchange, "/api/plaid/exchange", { publicToken: "public-sandbox-77aa" })).status).toBe(200);
    expect(addAccountPlaidItem).toHaveBeenCalledTimes(1);
    expect(vaultSet()).toBe(false);
  });

  it("never links a real (production) bank without accounts, even where accounts aren't set up", async () => {
    // A real deployment always has its own key, so the refusal below is the
    // account gate's, not a missing key's.
    vi.stubEnv("PLAID_ENV", "production");
    vi.stubEnv("PRISM_VAULT_KEY", Buffer.alloc(32, 7).toString("base64"));
    const res = await post(linkToken, "/api/plaid/link-token", { from: "/" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "accounts_required" });
    const saved = await post(exchange, "/api/plaid/exchange", { publicToken: "public-production-77aa" });
    expect(saved.status).toBe(503);
    expect(await saved.json()).toMatchObject({ error: "accounts_required" });
    expect(plaid).not.toHaveBeenCalled();
    expect(vaultSet()).toBe(false);
  });

  it("still links the sandbox into this device where accounts are off, so Prism can be developed", async () => {
    expect((await post(linkToken, "/api/plaid/link-token", { from: "/" })).status).toBe(200);
    expect((await post(exchange, "/api/plaid/exchange", { publicToken: "public-sandbox-77aa" })).status).toBe(200);
    expect(vaultSet()).toBe(true);
  });
});

// A bank that stopped updating (a changed password, an expired consent) is
// signed in to again with Plaid's update mode: the SAME connection, so its
// accounts, goals and household shares carry on and nothing is paid twice.
describe("signing in to a linked bank again", () => {
  beforeEach(() => {
    jar.clear();
    signedIn.current = { userId: "u1", email: "a@x.test" };
    accountItems.current = [{ itemId: "item-chase", accessToken: "access-production-chase", institutionId: "ins_56", institutionName: "Chase", linkedAt: "2026-09-30" }];
    allowList = [`${SITE}/connections/return`];
    plaid.mockClear();
    vi.stubGlobal("fetch", plaid);
    vi.stubEnv("PLAID_CLIENT_ID", "id");
    vi.stubEnv("PLAID_SECRET", "secret");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  });
  afterEach(() => {
    accountItems.current = [];
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens Link for that bank's existing connection, asking for no products", async () => {
    vi.stubEnv("PLAID_REDIRECT_URI", `${SITE}/connections/return`);
    const res = await post(linkToken, "/api/plaid/link-token", { from: "/net-worth", itemId: "item-chase" });
    expect(res.status).toBe(200);
    const sent = sentToPlaid()[0]!;
    expect(sent).toMatchObject({ access_token: "access-production-chase", user: { client_user_id: "u1" }, redirect_uri: `${SITE}/connections/return` });
    for (const product of ["products", "optional_products", "additional_consented_products", "transactions"]) expect(sent).not.toHaveProperty(product);
    // The access token went to Plaid, never to the browser.
    expect(JSON.stringify(await res.json())).not.toContain("access-production-chase");
    // Back from the bank's own site, the return page knows it's this bank again: nothing to exchange, and "Try again" means it again.
    expect(readReturn(jar.get(RETURN_COOKIE)!.value)).toEqual({ linkToken: "link-sandbox-4f1e", back: "/net-worth", reconnect: "item-chase" });
  });

  it("is only ever for the person's own banks: anyone else's, or one that's gone, reaches no Plaid at all", async () => {
    for (const itemId of ["item-someone-elses", "", 42, null]) {
      const res = await post(linkToken, "/api/plaid/link-token", { from: "/", itemId });
      expect(res.status, String(itemId)).toBe(404);
      expect(await res.json()).toMatchObject({ error: "not_found" });
    }
    expect(plaid).not.toHaveBeenCalled();
    expect(jar.has(RETURN_COOKIE)).toBe(false);
  });

  it("leaves a new connection exactly as it was", async () => {
    await post(linkToken, "/api/plaid/link-token", { from: "/" });
    const sent = sentToPlaid()[0]!;
    expect(sent).not.toHaveProperty("access_token");
    expect(sent).toMatchObject({ products: ["transactions"], optional_products: ["investments"], additional_consented_products: ["liabilities"] });
  });
});
