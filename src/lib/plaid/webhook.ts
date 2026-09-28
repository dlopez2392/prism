// src/lib/plaid/webhook.ts
//
// Is this webhook really from Plaid? Plaid signs every one: the
// Plaid-Verification header is an ES256 JWT whose key comes from Plaid's own
// API (by the JWT's key id), whose `iat` must be recent, and whose
// `request_body_sha256` must match the body exactly as it arrived. Anything
// else — no header, another algorithm, an unknown or expired key, a replay,
// a body changed in transit — is refused.

import { createHash, timingSafeEqual } from "node:crypto";
import { plaidRequest, type PlaidConfig } from "./client";

const MAX_AGE_S = 5 * 60;
/** Plaid's key ids are UUIDs; anything else is refused before Prism asks Plaid about it. */
const KID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A key is trusted from the cache this long, then asked about again — Plaid can expire it meanwhile. */
const KEY_TTL_MS = 60 * 60_000;
/** An id Plaid didn't recognise isn't asked about again for this long: a flood of made-up ids can't turn into a flood of calls to Plaid. */
const MISS_TTL_MS = 60_000;
const KEY_TIMEOUT_MS = 5_000;

type PlaidJwk = { alg: string; crv: string; kid: string; kty: string; use: string; x: string; y: string; created_at: number; expired_at: number | null };

/** Keys by id, for this server instance: the key (or null when Plaid had none) and when it was fetched. */
const keys = new Map<string, { key: PlaidJwk | null; at: number }>();
const MAX_CACHED = 100;

function part<T>(b64: string | undefined): T | null {
  try {
    return b64 ? (JSON.parse(Buffer.from(b64, "base64url").toString("utf8")) as T) : null;
  } catch {
    return null;
  }
}

async function keyFor(config: PlaidConfig, kid: string, now: number, fetchImpl?: typeof fetch): Promise<PlaidJwk | null> {
  const cached = keys.get(kid);
  if (cached && now - cached.at < (cached.key ? KEY_TTL_MS : MISS_TTL_MS)) return cached.key;
  let key: PlaidJwk | null = null;
  try {
    key = (await plaidRequest<{ key: PlaidJwk }>(config, "/webhook_verification_key/get", { key_id: kid }, fetchImpl, KEY_TIMEOUT_MS)).key;
  } catch {
    key = null;
  }
  if (keys.size >= MAX_CACHED) keys.delete(keys.keys().next().value!);
  keys.set(kid, { key, at: now });
  return key;
}

/** For tests: forget every cached key. */
export function forgetWebhookKeys(): void {
  keys.clear();
}

/** `rawBody` is the body's exact bytes as they arrived — the hash is over those, not over a decoded string. */
export async function verifyPlaidWebhook(
  config: PlaidConfig,
  jwt: string | null | undefined,
  rawBody: Uint8Array,
  opts: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<boolean> {
  if (!jwt || jwt.length > 4096) return false;
  const [h, p, s] = jwt.split(".");
  const header = part<{ alg?: string; kid?: string }>(h);
  const claims = part<{ iat?: number; request_body_sha256?: string }>(p);
  if (!header || !claims || !s || header.alg !== "ES256" || typeof header.kid !== "string" || !KID.test(header.kid)) return false;

  const nowMs = opts.now ?? Date.now();
  const jwk = await keyFor(config, header.kid, nowMs, opts.fetchImpl);
  if (!jwk || jwk.expired_at || jwk.kty !== "EC" || jwk.crv !== "P-256") return false;

  let valid = false;
  try {
    const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    // A JWS ES256 signature is the raw r‖s pair, exactly what WebCrypto verifies.
    valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, Buffer.from(s, "base64url"), Buffer.from(`${h}.${p}`, "ascii"));
  } catch {
    return false;
  }
  if (!valid) return false;

  const now = Math.floor(nowMs / 1000);
  if (typeof claims.iat !== "number" || Math.abs(now - claims.iat) > MAX_AGE_S) return false;

  const expected = typeof claims.request_body_sha256 === "string" ? claims.request_body_sha256 : "";
  const actual = createHash("sha256").update(rawBody).digest("hex");
  return expected.length === actual.length && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

/** Webhooks that mean "this bank has news worth a sync" — new transactions, or an item problem the next sync should surface. */
export function isSyncWorthy(body: { webhook_type?: unknown; webhook_code?: unknown }): boolean {
  if (body.webhook_type === "TRANSACTIONS") {
    return ["SYNC_UPDATES_AVAILABLE", "INITIAL_UPDATE", "HISTORICAL_UPDATE", "DEFAULT_UPDATE", "TRANSACTIONS_REMOVED"].includes(String(body.webhook_code));
  }
  if (body.webhook_type === "ITEM") {
    return ["ERROR", "PENDING_EXPIRATION", "PENDING_DISCONNECT", "USER_PERMISSION_REVOKED", "LOGIN_REPAIRED"].includes(String(body.webhook_code));
  }
  return false;
}
