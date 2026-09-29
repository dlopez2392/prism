// The two Coinbase routes a connection passes through, as the browser meets
// them: /api/coinbase/connect sends the person to coinbase.com, and
// /api/coinbase/callback trades the code Coinbase sends back for tokens.
// Coinbase is always real money, so both keep it for signed-in accounts only
// (src/lib/linking.ts), and the callback checks again before Coinbase is asked
// for anything.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COINBASE_COOKIE, COINBASE_OAUTH_COOKIE, startSignIn } from "@/lib/server/coinbase-store";

vi.mock("server-only", () => ({}));
const signedIn = { current: null as null | { userId: string; email: string } };
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => signedIn.current }));
const saveAccountCoinbase = vi.fn(async () => undefined);
vi.mock("@/lib/server/account-store", () => ({
  loadAccount: async () => ({ coinbase: null }),
  liveCoinbaseToken: async () => null,
  saveAccountCoinbase: (...a: unknown[]) => saveAccountCoinbase(...(a as [])),
}));

const { GET: connect } = await import("@/app/api/coinbase/connect/route");
const { GET: callback } = await import("@/app/api/coinbase/callback/route");

const SITE = "https://prism.bis-rgv.com";
const KEY = Buffer.alloc(32, 7);
const coinbase = vi.fn(async (url: RequestInfo | URL) => {
  if (new URL(String(url)).pathname === "/oauth2/token") return Response.json({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, token_type: "bearer" });
  return new Response(null, { status: 200 });
});

/** Coinbase sending this browser back, holding the sealed cookie `connect` gave it on the way out. */
function returning(): NextRequest {
  const { cookie, state } = startSignIn(`${SITE}/api/coinbase/callback`, KEY);
  return new NextRequest(`${SITE}/api/coinbase/callback?code=one-time-code&state=${state}`, { headers: { cookie: `${COINBASE_OAUTH_COOKIE}=${cookie}` } });
}
const where = (res: Response) => {
  const url = new URL(res.headers.get("location")!);
  return url.pathname + url.search;
};
const setsCookie = (res: Response, name: string) => (res.headers.getSetCookie?.() ?? []).some((c) => c.startsWith(`${name}=`) && !/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c));

describe("connecting Coinbase needs an account", () => {
  beforeEach(() => {
    signedIn.current = null;
    saveAccountCoinbase.mockClear();
    coinbase.mockClear();
    vi.stubGlobal("fetch", coinbase);
    vi.stubEnv("COINBASE_CLIENT_ID", "cb-id");
    vi.stubEnv("COINBASE_CLIENT_SECRET", "cb-secret");
    vi.stubEnv("PRISM_VAULT_KEY", KEY.toString("base64"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const accountsOn = () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  };

  it("sends someone signed out to sign in first, and back to Connections after", async () => {
    accountsOn();
    const res = await connect(new NextRequest(`${SITE}/api/coinbase/connect`));
    expect(res.status).toBe(303);
    expect(where(res)).toBe("/sign-in?why=coinbase&next=%2Fconnections");
    expect(setsCookie(res, COINBASE_OAUTH_COOKIE)).toBe(false);
  });

  it("sends a signed-in account on to Coinbase", async () => {
    accountsOn();
    signedIn.current = { userId: "u1", email: "a@x.test" };
    const res = await connect(new NextRequest(`${SITE}/api/coinbase/connect`));
    expect(new URL(res.headers.get("location")!).origin).toBe("https://login.coinbase.com");
    expect(setsCookie(res, COINBASE_OAUTH_COOKIE)).toBe(true);
  });

  it("never trades Coinbase's code for tokens once the session has ended, even mid-way through", async () => {
    accountsOn();
    const res = await callback(returning());
    expect(where(res)).toBe("/sign-in?why=coinbase&next=%2Fconnections");
    expect(coinbase).not.toHaveBeenCalled();
    expect(setsCookie(res, COINBASE_COOKIE)).toBe(false);
    expect(saveAccountCoinbase).not.toHaveBeenCalled();
  });

  it("keeps a signed-in account's Coinbase in the account, never in a cookie", async () => {
    accountsOn();
    signedIn.current = { userId: "u1", email: "a@x.test" };
    const res = await callback(returning());
    expect(where(res)).toBe("/connections?coinbase=connected");
    expect(saveAccountCoinbase).toHaveBeenCalledTimes(1);
    expect(setsCookie(res, COINBASE_COOKIE)).toBe(false);
  });

  it("refuses outright where accounts aren't set up, since Coinbase is always real money", async () => {
    const start = await connect(new NextRequest(`${SITE}/api/coinbase/connect`));
    expect(where(start)).toBe("/connections?coinbase=accounts_required");
    const finish = await callback(returning());
    expect(where(finish)).toBe("/connections?coinbase=accounts_required");
    expect(coinbase).not.toHaveBeenCalled();
    expect(setsCookie(finish, COINBASE_COOKIE)).toBe(false);
  });
});
