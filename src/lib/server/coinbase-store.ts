// src/lib/server/coinbase-store.ts
//
// Where a Coinbase link lives until Prism has accounts: an AES-256-GCM sealed,
// httpOnly cookie, exactly like a linked bank's Plaid token. Plus the one
// piece of state the sign-in needs between leaving for Coinbase and coming
// back: the PKCE verifier and the anti-forgery `state`, sealed in a cookie
// that lasts ten minutes.
//
// No "server-only" import on purpose: proxy.ts uses this file, and the proxy
// is not compiled with the react-server condition that package relies on.
// Nothing here is ever imported by a client component.

import { createHash, randomBytes } from "node:crypto";
import { refreshTokens, type CoinbaseConfig, type TokenSet } from "@/lib/coinbase/client";
import type { Env } from "@/lib/plaid/client";
import { openJson, sealJson, type VaultKey } from "./vault";

export const COINBASE_COOKIE = "prism-coinbase";
export const COINBASE_OAUTH_COOKIE = "prism-coinbase-oauth";

/** Refresh when less than this is left, so a page never renders on a token about to lapse. */
export const REFRESH_MARGIN_MS = 5 * 60_000;
const PENDING_TTL_MS = 10 * 60_000;

export type CoinbaseLink = TokenSet & { v: 1; linkedAt: string };

type Pending = { v: 1; state: string; verifier: string; redirectUri: string; createdAt: number };

const str = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length < 4096;

export function readLink(raw: string | undefined, key: VaultKey): CoinbaseLink | null {
  const v = openJson(raw, key) as Record<string, unknown> | null;
  if (!v || v.v !== 1 || !str(v.accessToken) || !str(v.refreshToken) || !Number.isFinite(v.expiresAt) || !str(v.linkedAt)) return null;
  return { v: 1, accessToken: v.accessToken, refreshToken: v.refreshToken, expiresAt: v.expiresAt as number, linkedAt: v.linkedAt };
}

export function sealLink(tokens: TokenSet, linkedAt: string, key: VaultKey): string {
  const link: CoinbaseLink = { v: 1, ...tokens, linkedAt };
  return sealJson(link, key);
}

export function needsRefresh(link: TokenSet, now = Date.now()): boolean {
  return link.expiresAt - now < REFRESH_MARGIN_MS;
}

export function isExpired(link: TokenSet, now = Date.now()): boolean {
  return link.expiresAt <= now;
}

/**
 * Trades the link's refresh token for a new pair and returns the new sealed
 * value — or null when no refresh is due or it failed. Coinbase refresh tokens
 * work ONCE, so the caller must persist what this returns, and on failure
 * must leave the cookie alone: a concurrent request may already have stored
 * the pair this one lost the race for.
 */
export async function refreshLink(
  raw: string | undefined,
  key: VaultKey,
  config: CoinbaseConfig,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<string | null> {
  const link = readLink(raw, key);
  if (!link || !needsRefresh(link, now)) return null;
  try {
    const next = await refreshTokens(config, link.refreshToken, fetchImpl, now);
    return sealLink(next, link.linkedAt, key);
  } catch {
    return null;
  }
}

const b64url = (b: Buffer) => b.toString("base64url");

/** A fresh sign-in attempt: the sealed cookie value, and what goes in the authorize URL. */
export function startSignIn(redirectUri: string, key: VaultKey, now = Date.now()): { cookie: string; state: string; challenge: string } {
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const pending: Pending = { v: 1, state, verifier, redirectUri, createdAt: now };
  return { cookie: sealJson(pending, key), state, challenge };
}

/** The pending sign-in, if this browser started one in the last ten minutes and `state` matches it. */
export function finishSignIn(raw: string | undefined, state: string | null, key: VaultKey, now = Date.now()): { verifier: string; redirectUri: string } | null {
  const p = openJson(raw, key) as Pending | null;
  if (!p || p.v !== 1 || !str(p.state) || !str(p.verifier) || !str(p.redirectUri) || !Number.isFinite(p.createdAt)) return null;
  if (now - p.createdAt > PENDING_TTL_MS || now < p.createdAt) return null;
  if (!state || state.length !== p.state.length || !timingSafeEqualStr(state, p.state)) return null;
  return { verifier: p.verifier, redirectUri: p.redirectUri };
}

function timingSafeEqualStr(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Exactly the URI sent to Coinbase, which must match what's registered with the app. */
export function redirectUriFor(config: CoinbaseConfig, origin: string): string {
  return config.redirectUri ?? `${origin}/api/coinbase/callback`;
}

export function linkCookieOptions(env: Env = process.env) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    // Browsers cap cookies at 400 days; the refresh token itself lasts 1.5 years.
    maxAge: 60 * 60 * 24 * 400,
  };
}

export function pendingCookieOptions(env: Env = process.env) {
  // Lax, because the return from Coinbase is a top-level GET navigation.
  return { ...linkCookieOptions(env), maxAge: PENDING_TTL_MS / 1000 };
}
