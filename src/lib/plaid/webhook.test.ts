import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaidConfig } from "./client";
import { bankWarning, forgetWebhookKeys, isSyncWorthy, verifyPlaidWebhook } from "./webhook";

const config: PlaidConfig = { clientId: "c", secret: "s", env: "sandbox", host: "https://plaid.test" };
const NOW = 1_790_600_000_000;
const b64 = (x: unknown) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");
// Plaid sends its body with two-space indentation; the hash is over those exact bytes.
const BODY = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-1", environment: "sandbox" }, null, 2);
const bytes = (s: string) => new Uint8Array(Buffer.from(s, "utf8"));
const KID = "6c5516e1-92dc-479e-a8ff-5a51992e0001";
const EXPIRED_KID = "6c5516e1-92dc-479e-a8ff-5a51992e0002";
const UNKNOWN_KID = "00000000-0000-4000-8000-000000000000";

let plaidKey: CryptoKeyPair;
let jwk: JsonWebKey;
let other: CryptoKeyPair;

beforeAll(async () => {
  plaidKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  jwk = await crypto.subtle.exportKey("jwk", plaidKey.publicKey);
});

async function sign(opts: { kid?: string; alg?: string; iat?: number; body?: string | Uint8Array; key?: CryptoKey } = {}): Promise<string> {
  const header = b64({ alg: opts.alg ?? "ES256", kid: opts.kid ?? KID, typ: "JWT" });
  const payload = b64({ iat: opts.iat ?? Math.floor(NOW / 1000), request_body_sha256: createHash("sha256").update(opts.body ?? BODY).digest("hex") });
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, opts.key ?? plaidKey.privateKey, Buffer.from(`${header}.${payload}`));
  return `${header}.${payload}.${Buffer.from(sig).toString("base64url")}`;
}

/** Plaid's /webhook_verification_key/get, serving one live key and one it has expired. */
function keyServer() {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toBe("https://plaid.test/webhook_verification_key/get");
    const { key_id } = JSON.parse(String(init?.body)) as { key_id: string };
    if (key_id !== KID && key_id !== EXPIRED_KID) return Response.json({ error_code: "INVALID_WEBHOOK_VERIFICATION_KEY_ID" }, { status: 400 });
    return Response.json({ key: { ...jwk, alg: "ES256", kid: key_id, use: "sig", created_at: 1, expired_at: key_id === EXPIRED_KID ? 2 : null } });
  });
}

beforeEach(() => forgetWebhookKeys());

describe("a webhook from Plaid", () => {
  it("is believed when Plaid's key signed exactly these bytes, just now", async () => {
    expect(await verifyPlaidWebhook(config, await sign(), bytes(BODY), { fetchImpl: keyServer() as unknown as typeof fetch, now: NOW })).toBe(true);
  });

  it("is checked over the raw bytes — a leading BOM a text decoder would drop still verifies", async () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(BODY)]);
    expect(await verifyPlaidWebhook(config, await sign({ body: withBom }), withBom, { fetchImpl: keyServer() as unknown as typeof fetch, now: NOW })).toBe(true);
  });

  it("is refused when anything is off", async () => {
    const fetchImpl = keyServer() as unknown as typeof fetch;
    const cases: [string, string | null, string][] = [
      ["no header", null, BODY],
      ["garbage", "not.a.jwt", BODY],
      ["body changed in transit", await sign(), BODY.replace("item-1", "item-2")],
      ["body re-serialised without Plaid's spacing", await sign(), JSON.stringify(JSON.parse(BODY))],
      ["signed by someone else's key", await sign({ key: other.privateKey }), BODY],
      ["another algorithm claimed", await sign({ alg: "HS256" }), BODY],
      ["an old webhook replayed", await sign({ iat: Math.floor(NOW / 1000) - 6 * 60 }), BODY],
      ["from the future", await sign({ iat: Math.floor(NOW / 1000) + 6 * 60 }), BODY],
      ["a key Plaid doesn't know", await sign({ kid: UNKNOWN_KID }), BODY],
      ["a key Plaid has expired", await sign({ kid: EXPIRED_KID }), BODY],
      ["a key id that isn't one", await sign({ kid: "../../admin" }), BODY],
    ];
    for (const [why, jwt, body] of cases) expect(await verifyPlaidWebhook(config, jwt, bytes(body), { fetchImpl, now: NOW }), why).toBe(false);
  });

  it("asks Plaid about a key once an hour, not per webhook — and made-up ids don't become calls to Plaid", async () => {
    const fetchImpl = keyServer();
    const f = fetchImpl as unknown as typeof fetch;
    const jwt = await sign();
    await verifyPlaidWebhook(config, jwt, bytes(BODY), { fetchImpl: f, now: NOW });
    await verifyPlaidWebhook(config, jwt, bytes(BODY), { fetchImpl: f, now: NOW + 1_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // After the hour, asked again (Plaid may have expired it meanwhile).
    await verifyPlaidWebhook(config, await sign({ iat: Math.floor((NOW + 61 * 60_000) / 1000) }), bytes(BODY), { fetchImpl: f, now: NOW + 61 * 60_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const junk = await sign({ kid: UNKNOWN_KID });
    for (let i = 0; i < 5; i++) await verifyPlaidWebhook(config, junk, bytes(BODY), { fetchImpl: f, now: NOW + 61 * 60_000 + i });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // And a key id that isn't a UUID never reaches Plaid at all.
    await verifyPlaidWebhook(config, await sign({ kid: "not-a-uuid" }), bytes(BODY), { fetchImpl: f, now: NOW });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("which webhooks mean 'sync this bank'", () => {
  it("new or changed transactions, and item problems the next sync should surface", () => {
    expect(isSyncWorthy({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE" })).toBe(true);
    expect(isSyncWorthy({ webhook_type: "ITEM", webhook_code: "ERROR" })).toBe(true);
    expect(isSyncWorthy({ webhook_type: "ITEM", webhook_code: "WEBHOOK_UPDATE_ACKNOWLEDGED" })).toBe(false);
    expect(isSyncWorthy({ webhook_type: "HOLDINGS", webhook_code: "DEFAULT_UPDATE" })).toBe(false);
    expect(isSyncWorthy({})).toBe(false);
  });
});

describe("a bank's warnings, as Plaid sends them", () => {
  const item = (webhook_code: string, extra: Record<string, unknown> = {}) => bankWarning({ webhook_type: "ITEM", webhook_code, ...extra });

  it("knows a sign-in, a consent ending on a date, a withdrawal and a repair", () => {
    expect(item("ERROR", { error: { error_code: "ITEM_LOGIN_REQUIRED" } })).toEqual({ event: "login-required", at: null });
    // US and Canada say PENDING_DISCONNECT with disconnect_time; Europe says PENDING_EXPIRATION with consent_expiration_time.
    expect(item("PENDING_DISCONNECT", { reason: "INSTITUTION_TOKEN_EXPIRATION", disconnect_time: "2026-10-08T13:25:17.766Z" })).toEqual({ event: "disconnecting", at: "2026-10-08T13:25:17.766Z" });
    expect(item("PENDING_EXPIRATION", { consent_expiration_time: "2026-10-08T13:25:17Z" })).toEqual({ event: "disconnecting", at: "2026-10-08T13:25:17.000Z" });
    expect(item("USER_PERMISSION_REVOKED")).toEqual({ event: "revoked", at: null });
    expect(item("USER_ACCOUNT_REVOKED")).toEqual({ event: "revoked", at: null });
    expect(item("LOGIN_REPAIRED")).toEqual({ event: "repaired", at: null });
    expect(isSyncWorthy({ webhook_type: "ITEM", webhook_code: "USER_ACCOUNT_REVOKED" })).toBe(true);
  });

  it("warns about nothing else: other errors, a consent with no date, other kinds of webhook", () => {
    expect(item("ERROR", { error: { error_code: "INSTITUTION_DOWN" } })).toBeNull();
    expect(item("ERROR", { error: null })).toBeNull();
    expect(item("PENDING_DISCONNECT")).toBeNull();
    expect(item("PENDING_DISCONNECT", { disconnect_time: "soon" })).toBeNull();
    expect(item("NEW_ACCOUNTS_AVAILABLE")).toBeNull();
    expect(bankWarning({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE" })).toBeNull();
  });
});
