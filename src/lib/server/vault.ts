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
import type { Env } from "@/lib/plaid/client";

export const VAULT_COOKIE = "prism-vault";
export const VAULT_MAX_AGE = 60 * 60 * 24 * 30;

export type VaultItem = { itemId: string; accessToken: string; institutionId: string | null; institutionName: string | null; linkedAt: string };
export type Vault = { v: 1; userId: string; items: VaultItem[] };

export function emptyVault(): Vault {
  return { v: 1, userId: randomUUID(), items: [] };
}

/**
 * The 32-byte key. PRISM_VAULT_KEY (base64, 32 bytes) is required in
 * production. In the Plaid sandbox only, a key derived from PLAID_SECRET is
 * accepted so a first-time developer can link a test bank with two env vars.
 */
export function vaultKey(env: Env = process.env): Buffer | null {
  const raw = env.PRISM_VAULT_KEY?.trim();
  if (raw) {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error("PRISM_VAULT_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).");
    return key;
  }
  if (env.PLAID_ENV?.trim() !== "production" && env.PLAID_SECRET?.trim()) {
    return createHash("sha256").update(`prism-vault-sandbox:${env.PLAID_SECRET.trim()}`).digest();
  }
  return null;
}

export function seal(vault: Vault, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(vault), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** Null for anything that is not a vault this key sealed — tampered, truncated, or foreign. */
export function open(token: string | undefined, key: Buffer): Vault | null {
  if (!token) return null;
  try {
    const buf = Buffer.from(token, "base64url");
    if (buf.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const json = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(json) as Vault;
    return parsed && parsed.v === 1 && Array.isArray(parsed.items) ? parsed : null;
  } catch {
    return null;
  }
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
