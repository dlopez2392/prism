import { describe, expect, it, vi } from "vitest";
import { authorizeUrl, CoinbaseError, coinbaseConfig, exchangeCode, listAccounts, refreshTokens, revokeToken, usdRates, type CoinbaseConfig } from "./client";

const config: CoinbaseConfig = {
  clientId: "cid",
  clientSecret: "secret",
  redirectUri: null,
  loginUrl: "https://login.example",
  apiUrl: "https://api.example",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fetch that records every call and answers from a list, in order. */
function fakeFetch(...responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const form = (init: RequestInit) => new URLSearchParams(String(init.body));

describe("coinbaseConfig", () => {
  it("is off without both keys", () => {
    expect(coinbaseConfig({})).toBeNull();
    expect(coinbaseConfig({ COINBASE_CLIENT_ID: "a" })).toBeNull();
  });

  it("defaults to Coinbase's real hosts and trims test overrides", () => {
    expect(coinbaseConfig({ COINBASE_CLIENT_ID: " a ", COINBASE_CLIENT_SECRET: "b" })).toEqual({
      clientId: "a",
      clientSecret: "b",
      redirectUri: null,
      loginUrl: "https://login.coinbase.com",
      apiUrl: "https://api.coinbase.com",
    });
    expect(coinbaseConfig({ COINBASE_CLIENT_ID: "a", COINBASE_CLIENT_SECRET: "b", COINBASE_API_URL: "http://localhost:3199/" })!.apiUrl).toBe("http://localhost:3199");
  });
});

describe("authorizeUrl", () => {
  it("asks for read-only balances plus a refresh token, with PKCE", () => {
    const url = new URL(authorizeUrl(config, { state: "st4te-value", challenge: "chal", redirectUri: "https://prism.example/api/coinbase/callback" }));
    expect(url.origin + url.pathname).toBe("https://login.example/oauth2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "cid",
      redirect_uri: "https://prism.example/api/coinbase/callback",
      state: "st4te-value",
      scope: "wallet:accounts:read,offline_access",
      code_challenge: "chal",
      code_challenge_method: "S256",
    });
  });
});

describe("token requests", () => {
  it("exchanges a code form-encoded, with the verifier, and dates the expiry", async () => {
    const f = fakeFetch(json({ access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "bearer" }));
    const t = await exchangeCode(config, { code: "c0de", verifier: "v", redirectUri: "https://r" }, f.impl, 1_000);
    expect(t).toEqual({ accessToken: "at", refreshToken: "rt", expiresAt: 1_000 + 3_600_000 });
    expect(f.calls[0]!.url).toBe("https://login.example/oauth2/token");
    expect(f.calls[0]!.init.headers).toMatchObject({ "Content-Type": "application/x-www-form-urlencoded" });
    expect(Object.fromEntries(form(f.calls[0]!.init))).toEqual({
      grant_type: "authorization_code",
      code: "c0de",
      code_verifier: "v",
      redirect_uri: "https://r",
      client_id: "cid",
      client_secret: "secret",
    });
  });

  it("spends a refresh token with no code or redirect", async () => {
    const f = fakeFetch(json({ access_token: "at2", refresh_token: "rt2", expires_in: 3600 }));
    await refreshTokens(config, "rt", f.impl);
    expect(Object.fromEntries(form(f.calls[0]!.init))).toEqual({ grant_type: "refresh_token", refresh_token: "rt", client_id: "cid", client_secret: "secret" });
  });

  it("refuses a grant without a refresh token rather than dying in an hour", async () => {
    const f = fakeFetch(json({ access_token: "at", expires_in: 3600 }));
    await expect(exchangeCode(config, { code: "c", verifier: "v", redirectUri: "r" }, f.impl)).rejects.toMatchObject({ code: "no_refresh_token" });
  });

  it("marks a used or revoked refresh token as needing a new sign-in", async () => {
    const f = fakeFetch(json({ error: "invalid_grant" }, 400));
    const err = await refreshTokens(config, "used", f.impl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoinbaseError);
    expect((err as CoinbaseError).needsReconnect).toBe(true);
    expect(new CoinbaseError(503, "token_error", "x").needsReconnect).toBe(false);
    expect(new CoinbaseError(401, "accounts_failed", "x").needsReconnect).toBe(true);
  });

  it("revokes with the token as both the subject and the bearer", async () => {
    const f = fakeFetch(new Response(null, { status: 200 }));
    await revokeToken(config, "at", f.impl);
    expect(f.calls[0]!.url).toBe("https://login.example/oauth2/revoke");
    expect(f.calls[0]!.init.headers).toMatchObject({ Authorization: "Bearer at" });
    expect(form(f.calls[0]!.init).get("token")).toBe("at");
  });
});

describe("listAccounts", () => {
  const wallet = (code: string) => ({ id: code, name: `${code} Wallet`, type: "wallet", currency: { code, name: code }, balance: { amount: "1", currency: code } });

  it("follows Coinbase's cursor to the last page", async () => {
    const f = fakeFetch(
      json({ data: [wallet("BTC")], pagination: { next_uri: "/v2/accounts?limit=100&starting_after=BTC" } }),
      json({ data: [wallet("ETH")], pagination: { next_uri: null } }),
    );
    const out = await listAccounts(config, "at", f.impl);
    expect(out.map((a) => a.id)).toEqual(["BTC", "ETH"]);
    expect(f.calls.map((c) => c.url)).toEqual(["https://api.example/v2/accounts?limit=100", "https://api.example/v2/accounts?limit=100&starting_after=BTC"]);
    expect(f.calls[0]!.init.headers).toMatchObject({ Authorization: "Bearer at" });
  });

  it("never follows a cursor somewhere else", async () => {
    const f = fakeFetch(json({ data: [wallet("BTC")], pagination: { next_uri: "https://evil.example/steal" } }));
    expect(await listAccounts(config, "at", f.impl)).toHaveLength(1);
    expect(f.calls).toHaveLength(1);
  });

  it("stops after twenty pages even if Coinbase keeps saying there's more", async () => {
    const pages = Array.from({ length: 25 }, (_, i) => json({ data: [wallet(`C${i}`)], pagination: { next_uri: `/v2/accounts?starting_after=C${i}` } }));
    const f = fakeFetch(...pages);
    expect(await listAccounts(config, "at", f.impl)).toHaveLength(20);
  });

  it("reports an expired token as a reconnect", async () => {
    const f = fakeFetch(json({ errors: [{ id: "expired_token" }] }, 401));
    await expect(listAccounts(config, "at", f.impl)).rejects.toMatchObject({ needsReconnect: true });
  });
});

describe("usdRates", () => {
  it("reads string rates as numbers, drops junk, and pins the dollar at 1", async () => {
    const f = fakeFetch(json({ data: { currency: "USD", rates: { BTC: "0.0000155", ETH: "0.00031", BAD: "abc", ZERO: "0", USD: "1.0" } } }));
    expect(await usdRates(config, f.impl)).toEqual({ BTC: 0.0000155, ETH: 0.00031, USD: 1 });
    expect(f.calls[0]!.url).toBe("https://api.example/v2/exchange-rates?currency=USD");
  });
});
