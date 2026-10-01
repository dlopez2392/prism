// src/lib/server/vault.ts
//
// Where a linked bank's Plaid access token lives in this prototype: an
// AES-256-GCM sealed, httpOnly cookie. The token never reaches browser
// JavaScript, is unreadable at rest without the server key, and tampering
// fails authentication instead of decrypting to garbage.
//
// This is a deliberate PROTOTYPE choice — it needs no database. Production
// moves the sealed blob into a server-side store (per-user row, envelope-
// encrypted with a KMS key) and keeps only a session id in the cookie; the
// seal/open functions below are the part that carries over unchanged.

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { isPreviewDeployment } from "@/lib/deployment";
import type { Env } from "@/lib/plaid/client";

export const VAULT_COOKIE = "prism-vault";
export const VAULT_MAX_AGE = 60 * 60 * 24 * 30;

export type VaultItem = { itemId: string; accessToken: string; institutionId: string | null; institutionName: string | null; linkedAt: string };
export type Vault = { v: 1; userId: string; items: VaultItem[] };

export function emptyVault(): Vault {
  return { v: 1, userId: randomUUID(), items: [] };
}

/** A vault key and its id: a short hash, so a stored seal can say which key made it without revealing the key. */
export type KeyEntry = { readonly key: Buffer; readonly id: string };

/**
 * Every vault key Prism holds. `current` makes every new seal; every key in
 * `all` (current first) still opens what it sealed. That is what lets the key
 * be replaced without anyone reconnecting a bank: add the new key, and what
 * the old one sealed is sealed again under the new one as each person uses
 * Prism (account-store's `reseal`). README, "Replacing the vault key".
 */
export type Keyring = { readonly current: KeyEntry; readonly all: readonly KeyEntry[] };

/** What seals and opens take: the environment's keyring, or one bare 32-byte key (a ring of one). */
export type VaultKey = Keyring | Buffer;

/** 8 base64url characters of a domain-separated SHA-256: names a key, reveals nothing about it. */
export function keyId(key: Buffer): string {
  return createHash("sha256").update("prism-vault-key-id\0").update(key).digest("base64url").slice(0, 8);
}

function ring(key: VaultKey): Keyring {
  if (!Buffer.isBuffer(key)) return key;
  const entry = { key, id: keyId(key) };
  return { current: entry, all: [entry] };
}

/** PRISM_VAULT_KEY is key 1; a replacement is PRISM_VAULT_KEY_2, then _3, up to _99. Anything else is not a vault key. */
const KEY_VAR = /^PRISM_VAULT_KEY(?:_([2-9]|[1-9][0-9]))?$/;

/**
 * The keyring. Each PRISM_VAULT_KEY[_n] is 32 bytes, base64; the highest
 * number seals and every one opens. Numbered names, not "current" and "old",
 * because a sensitive variable can't be read back: replacing the key is only
 * ever ADDING the next number, and retiring one is deleting it.
 *
 * At least one is required in production. In the Plaid sandbox only, a key
 * derived from PLAID_SECRET is accepted so a first-time developer can link a
 * test bank with two env vars. A Vercel preview never has one, even if it is
 * given one by mistake: it runs unmerged code (deployment.ts).
 */
export function vaultKey(env: Env = process.env): Keyring | null {
  if (isPreviewDeployment(env)) return null;
  const found: { n: number; name: string; entry: KeyEntry }[] = [];
  for (const [name, value] of Object.entries(env)) {
    const m = KEY_VAR.exec(name);
    const raw = value?.trim();
    if (!m || !raw) continue;
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error(`${name} must be 32 bytes, base64-encoded (openssl rand -base64 32).`);
    const twin = found.find((f) => f.entry.key.equals(key));
    if (twin) throw new Error(`${name} is the same key as ${twin.name}. A replacement key must be new.`);
    found.push({ n: m[1] ? Number(m[1]) : 1, name, entry: { key, id: keyId(key) } });
  }
  if (found.length > 0) {
    const all = found.sort((a, b) => b.n - a.n).map((f) => f.entry);
    return { current: all[0]!, all };
  }
  if (env.PLAID_ENV?.trim() !== "production" && env.PLAID_SECRET?.trim()) {
    return ring(createHash("sha256").update(`prism-vault-sandbox:${env.PLAID_SECRET.trim()}`).digest());
  }
  return null;
}

/**
 * Seal formats. With one key, a seal is what it has always been — bare
 * base64url for JSON, "z1." for gzipped JSON — so a deploy changes nothing
 * stored and an older release can still read everything. While a rotation is
 * under way (two keys or more), each new seal names its key: "j2.<id>." or
 * "z2.<id>.". Anything without an id then belongs to an older key, so it is
 * sealed again, and the README's census can count what's left. An unnamed
 * seal is opened by trying each key; a wrong key fails GCM authentication,
 * never decrypts to garbage.
 */
const JSON_PREFIX = "j2.";
const PACKED_PREFIX = "z2.";
const LEGACY_PACKED_PREFIX = "z1.";
const ID_LENGTH = 8;

/** The keys that might open `token`, and the ciphertext to try them on. */
function candidates(token: string, key: VaultKey, prefix: string, legacy: (t: string) => string | null): { keys: readonly KeyEntry[]; body: string } | null {
  const r = ring(key);
  if (token.startsWith(prefix)) {
    if (token[prefix.length + ID_LENGTH] !== ".") return null;
    const id = token.slice(prefix.length, prefix.length + ID_LENGTH);
    return { keys: r.all.filter((k) => k.id === id), body: token.slice(prefix.length + ID_LENGTH + 1) };
  }
  const body = legacy(token);
  return body === null ? null : { keys: r.all, body };
}

function decrypt(body: string, key: Buffer): Buffer | null {
  try {
    const buf = Buffer.from(body, "base64url");
    if (buf.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
  } catch {
    return null;
  }
}

function encrypt(plain: Buffer, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/**
 * True, during a rotation, when a stored seal isn't one the current key made
 * (one that names another key, or names none), so it should be sealed again.
 * Never true with a single key: whatever opens was sealed by it. Says nothing
 * about whether the seal opens.
 */
export function needsReseal(token: string | null | undefined, key: VaultKey): boolean {
  const r = ring(key);
  if (!token || r.all.length < 2) return false;
  const { id } = r.current;
  return !token.startsWith(`${JSON_PREFIX}${id}.`) && !token.startsWith(`${PACKED_PREFIX}${id}.`);
}

/** The seal's key id, while a rotation needs one; nothing otherwise (see "Seal formats"). */
function named(r: Keyring, prefix: string, legacy: string): string {
  return r.all.length < 2 ? legacy : `${prefix}${r.current.id}.`;
}

/** AES-256-GCM: iv ‖ tag ‖ ciphertext, base64url, named during a rotation. Shared by every sealed cookie and column. */
export function sealJson(value: unknown, key: VaultKey): string {
  const r = ring(key);
  return named(r, JSON_PREFIX, "") + encrypt(Buffer.from(JSON.stringify(value), "utf8"), r.current.key);
}

/** The parsed value, or null for anything no key in the ring sealed — tampered, truncated, foreign, or a retired key's. */
export function openJson(token: string | undefined, key: VaultKey): unknown {
  if (!token) return null;
  const c = candidates(token, key, JSON_PREFIX, (t) => (t.includes(".") ? null : t));
  for (const k of c?.keys ?? []) {
    const plain = decrypt(c!.body, k.key);
    if (!plain) continue;
    try {
      return JSON.parse(plain.toString("utf8"));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * For what's too big for sealJson to keep cheaply — a bank's synced
 * transactions: gzip, then AES-256-GCM, marked "z1." ("z2.<key id>." during a rotation). Opening
 * refuses to inflate past PACKED_MAX, so a forged or corrupt blob can never
 * balloon in memory (and a forged one fails authentication before that).
 */
const PACKED_MAX = 64 * 1024 * 1024;

export function sealPacked(value: unknown, key: VaultKey): string {
  const json = Buffer.from(JSON.stringify(value), "utf8");
  // Never seal what openPacked would refuse to inflate: it could never be opened again.
  if (json.length > PACKED_MAX) throw new Error(`Too large to seal (${json.length} bytes).`);
  const r = ring(key);
  return named(r, PACKED_PREFIX, LEGACY_PACKED_PREFIX) + encrypt(gzipSync(json), r.current.key);
}

export function openPacked(token: string | null | undefined, key: VaultKey): unknown {
  if (!token) return null;
  const c = candidates(token, key, PACKED_PREFIX, (t) => (t.startsWith(LEGACY_PACKED_PREFIX) ? t.slice(LEGACY_PACKED_PREFIX.length) : null));
  for (const k of c?.keys ?? []) {
    const packed = decrypt(c!.body, k.key);
    if (!packed) continue;
    try {
      return JSON.parse(gunzipSync(packed, { maxOutputLength: PACKED_MAX }).toString("utf8"));
    } catch {
      return null;
    }
  }
  return null;
}

export function seal(vault: Vault, key: VaultKey): string {
  return sealJson(vault, key);
}

/** Null for anything that is not a vault this key sealed — tampered, truncated, or foreign. */
export function open(token: string | undefined, key: VaultKey): Vault | null {
  const parsed = openJson(token, key) as Vault | null;
  return parsed && parsed.v === 1 && Array.isArray(parsed.items) ? parsed : null;
}

export function cookieOptions(env: Env = process.env) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: VAULT_MAX_AGE,
  };
}
