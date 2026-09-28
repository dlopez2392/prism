// src/lib/coinbase/client.ts
//
// A minimal, dependency-free Coinbase App client for ONE thing: reading a
// person's balances, read-only. OAuth2 with PKCE on login.coinbase.com, then
// GET /v2/accounts on api.coinbase.com, priced in dollars from Coinbase's own
// public exchange rates. Prism never asks for a scope that can move money.
//
// Facts from docs.cdp.coinbase.com (September 2026) this file is built on:
//   - access tokens last one hour;
//   - refresh tokens last 1.5 years and can be exchanged ONCE — every refresh
//     returns a new pair, and reusing an old refresh token is a 401;
//   - revoking the access token also kills its paired refresh token;
//   - scopes are comma-separated, and offline_access is what yields a
//     refresh token at all.
//
// Configuration (server-only):
//   COINBASE_CLIENT_ID, COINBASE_CLIENT_SECRET — from the Coinbase Developer Platform
//   COINBASE_REDIRECT_URI  — optional; defaults to <origin>/api/coinbase/callback
//   COINBASE_LOGIN_URL, COINBASE_API_URL — test hooks only; leave unset

import type { Env } from "@/lib/plaid/client";

export type CoinbaseConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string | null;
  loginUrl: string;
  apiUrl: string;
};

/** Read balances, and stay connected. Nothing that can send, buy, sell or convert. */
export const COINBASE_SCOPES = ["wallet:accounts:read", "offline_access"] as const;

export function coinbaseConfig(env: Env = process.env): CoinbaseConfig | null {
  const clientId = env.COINBASE_CLIENT_ID?.trim();
  const clientSecret = env.COINBASE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: env.COINBASE_REDIRECT_URI?.trim() || null,
    loginUrl: (env.COINBASE_LOGIN_URL?.trim() || "https://login.coinbase.com").replace(/\/+$/, ""),
    apiUrl: (env.COINBASE_API_URL?.trim() || "https://api.coinbase.com").replace(/\/+$/, ""),
  };
}

export class CoinbaseError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CoinbaseError";
  }

  /** The link itself is dead (revoked, expired or already-used refresh token): only a new sign-in fixes it. */
  get needsReconnect(): boolean {
    return this.status === 401 || this.code === "invalid_grant" || this.code === "revoked_token";
  }
}

export type TokenSet = { accessToken: string; refreshToken: string; expiresAt: number };

export function authorizeUrl(config: CoinbaseConfig, opts: { state: string; challenge: string; redirectUri: string }): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    scope: COINBASE_SCOPES.join(","),
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
  });
  return `${config.loginUrl}/oauth2/auth?${q}`;
}

async function tokenRequest(config: CoinbaseConfig, params: Record<string, string>, fetchImpl: typeof fetch, now: number): Promise<TokenSet> {
  const res = await fetchImpl(`${config.loginUrl}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ ...params, client_id: config.clientId, client_secret: config.clientSecret }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof json.error === "string" ? json.error : "token_error";
    throw new CoinbaseError(res.status, code, `Coinbase token request failed: ${res.status} ${code}`);
  }
  const accessToken = json.access_token;
  const refreshToken = json.refresh_token;
  const expiresIn = Number(json.expires_in);
  if (typeof accessToken !== "string" || !accessToken || typeof refreshToken !== "string" || !refreshToken) {
    // Without a refresh token the link would die in an hour; refuse it rather than pretend.
    throw new CoinbaseError(502, "no_refresh_token", "Coinbase did not return a refresh token (is offline_access allowed for this app?).");
  }
  return { accessToken, refreshToken, expiresAt: now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000 };
}

export function exchangeCode(
  config: CoinbaseConfig,
  opts: { code: string; verifier: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<TokenSet> {
  return tokenRequest(config, { grant_type: "authorization_code", code: opts.code, code_verifier: opts.verifier, redirect_uri: opts.redirectUri }, fetchImpl, now);
}

/** Spends `refreshToken` for good: the caller MUST persist the pair this returns. */
export function refreshTokens(config: CoinbaseConfig, refreshToken: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<TokenSet> {
  return tokenRequest(config, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl, now);
}

export async function revokeToken(config: CoinbaseConfig, accessToken: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${config.loginUrl}/oauth2/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${accessToken}` },
    body: new URLSearchParams({ token: accessToken, client_id: config.clientId, client_secret: config.clientSecret }),
    cache: "no-store",
  });
  if (!res.ok) throw new CoinbaseError(res.status, "revoke_failed", `Coinbase revoke failed: ${res.status}`);
}

export type CoinbaseAccount = {
  id: string;
  name: string;
  type: string;
  currency: { code: string; name: string; type?: string };
  balance: { amount: string; currency: string };
};

const MAX_PAGES = 20;

/** Every wallet the person has, following Coinbase's cursor pages to the end. */
export async function listAccounts(config: CoinbaseConfig, accessToken: string, fetchImpl: typeof fetch = fetch): Promise<CoinbaseAccount[]> {
  const out: CoinbaseAccount[] = [];
  let path: string | null = "/v2/accounts?limit=100";
  for (let page = 0; path && page < MAX_PAGES; page++) {
    const res: Response = await fetchImpl(`${config.apiUrl}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { data?: unknown; pagination?: { next_uri?: string | null } };
    if (!res.ok) throw new CoinbaseError(res.status, "accounts_failed", `Coinbase /v2/accounts failed: ${res.status}`);
    if (Array.isArray(json.data)) out.push(...(json.data as CoinbaseAccount[]));
    const next = json.pagination?.next_uri;
    // Only ever follow a cursor back to the same endpoint.
    path = typeof next === "string" && next.startsWith("/v2/accounts?") ? next : null;
  }
  return out;
}

/** Units of each currency per US dollar, from Coinbase's public rates (no sign-in needed). */
export async function usdRates(config: CoinbaseConfig, fetchImpl: typeof fetch = fetch): Promise<Record<string, number>> {
  const res = await fetchImpl(`${config.apiUrl}/v2/exchange-rates?currency=USD`, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new CoinbaseError(res.status, "rates_failed", `Coinbase exchange rates failed: ${res.status}`);
  const json = (await res.json().catch(() => ({}))) as { data?: { rates?: Record<string, unknown> } };
  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(json.data?.rates ?? {})) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) rates[code] = n;
  }
  rates.USD = 1;
  return rates;
}
