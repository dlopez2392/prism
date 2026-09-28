// The two Plaid routes a bank redirect passes through, as the browser meets
// them: /api/plaid/link-token remembers the Link token (and where the person
// started) only when Plaid may send them back, and /api/plaid/exchange forgets
// it once the bank is linked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("@/lib/server/account-store", () => ({ loadAccount: async () => ({ items: [] }), addAccountPlaidItem: (...a: unknown[]) => addAccountPlaidItem(...(a as [])) }));

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
    expect(readReturn(saved.value)).toEqual({ linkToken: "link-sandbox-4f1e", back: "/budgets" });
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
