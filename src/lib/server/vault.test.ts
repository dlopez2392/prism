import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { cookieOptions, emptyVault, keyId, needsReseal, open, openJson, openPacked, seal, sealJson, sealPacked, type Vault, vaultKey } from "./vault";

const key = randomBytes(32);
const vault: Vault = {
  ...emptyVault(),
  items: [{ itemId: "item-1", accessToken: "access-sandbox-abc", institutionId: "ins_1", institutionName: "First Platypus Bank", linkedAt: "2026-09-27T00:00:00Z" }],
};

describe("the token vault", () => {
  it("round-trips a sealed vault", () => {
    expect(open(seal(vault, key), key)).toEqual(vault);
  });

  it("never contains the access token in readable form", () => {
    const sealed = seal(vault, key);
    expect(sealed).not.toContain("access-sandbox");
    expect(Buffer.from(sealed, "base64url").toString("utf8")).not.toContain("access-sandbox");
  });

  it("uses a fresh IV every time", () => {
    expect(seal(vault, key)).not.toBe(seal(vault, key));
  });

  it("rejects tampering, a foreign key, and junk", () => {
    const sealed = seal(vault, key);
    const buf = Buffer.from(sealed, "base64url");
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0x01;
    expect(open(buf.toString("base64url"), key)).toBeNull();
    expect(open(sealed, randomBytes(32))).toBeNull();
    expect(open("not-a-vault", key)).toBeNull();
    expect(open(undefined, key)).toBeNull();
  });
});

describe("vaultKey", () => {
  it("requires an explicit 32-byte key in production", () => {
    expect(vaultKey({ PLAID_ENV: "production", PLAID_SECRET: "s" })).toBeNull();
    expect(() => vaultKey({ PRISM_VAULT_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/32 bytes/);
    expect(vaultKey({ PRISM_VAULT_KEY: key.toString("base64") })?.current.key).toEqual(key);
  });

  it("derives a sandbox-only key from the Plaid secret", () => {
    const a = vaultKey({ PLAID_SECRET: "sandbox-secret" })?.current.key;
    expect(a).toHaveLength(32);
    expect(vaultKey({ PLAID_SECRET: "sandbox-secret" })?.current.key).toEqual(a);
    expect(vaultKey({ PLAID_SECRET: "sandbox-secret", PRISM_VAULT_KEY: key.toString("base64") })?.all).toHaveLength(1);
    expect(vaultKey({})).toBeNull();
  });
});

describe("cookieOptions", () => {
  it("keeps the vault away from scripts and cross-site requests", () => {
    expect(cookieOptions({ NODE_ENV: "production" })).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
  });
});

describe("packed sealing (a bank's synced transactions)", () => {
  const key = randomBytes(32);
  const txns = Array.from({ length: 2000 }, (_, i) => ({
    transaction_id: `txn-${i}`,
    account_id: "acc-1",
    amount: 12.34 + i,
    date: "2026-09-01",
    name: "Green Basket Market",
    merchant_name: "Green Basket Market",
    pending: false,
  }));

  it("round-trips, smaller than it went in, and unreadable at rest", () => {
    const sealed = sealPacked({ cursor: "c-1", transactions: txns }, key);
    expect(openPacked(sealed, key)).toEqual({ cursor: "c-1", transactions: txns });
    expect(sealed.startsWith("z1.")).toBe(true);
    expect(sealed.length).toBeLessThan(JSON.stringify(txns).length / 4);
    expect(sealed).not.toContain("Green");
    expect(Buffer.from(sealed.slice(3), "base64url").toString("latin1")).not.toContain("Green Basket");
  });

  it("opens nothing it didn't seal: another key, tampering, the unpacked format, junk", () => {
    const sealed = sealPacked({ a: 1 }, key);
    expect(openPacked(sealed, randomBytes(32))).toBeNull();
    const flipped = `z1.${Buffer.from(Buffer.from(sealed.slice(3), "base64url").map((b, i) => (i === 40 ? b ^ 1 : b))).toString("base64url")}`;
    expect(openPacked(flipped, key)).toBeNull();
    expect(openPacked(sealJson({ a: 1 }, key), key)).toBeNull();
    for (const junk of [null, undefined, "", "z1.", "z1.%%%", "z2.", `z2.${keyId(key)}`, `z2.${keyId(key)}x%%`, "nope"]) expect(openPacked(junk, key)).toBeNull();
  });
});

// The seal formats before key ids, exactly as the previous release wrote them,
// so every seal already in a database or a cookie keeps opening.
function legacyJson(value: unknown, k: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}
/** The previous release's openers, verbatim: what a rollback would run. */
function legacyOpenJson(token: string, k: Buffer): unknown {
  try {
    const buf = Buffer.from(token, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", k, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8"));
  } catch {
    return null;
  }
}
function legacyOpenPacked(token: string, k: Buffer): unknown {
  if (!token.startsWith("z1.")) return null;
  const buf = Buffer.from(token.slice(3), "base64url");
  const decipher = createDecipheriv("aes-256-gcm", k, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(gunzipSync(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()])).toString("utf8"));
}
function legacyPacked(value: unknown, k: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(value), "utf8"))), cipher.final()]);
  return `z1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

describe("replacing the vault key", () => {
  const k1 = randomBytes(32);
  const k2 = randomBytes(32);
  const k3 = randomBytes(32);
  const b64 = (k: Buffer) => k.toString("base64");
  const before = vaultKey({ PRISM_VAULT_KEY: b64(k1) })!;
  const during = vaultKey({ PRISM_VAULT_KEY: b64(k1), PRISM_VAULT_KEY_2: b64(k2) })!;
  const after = vaultKey({ PRISM_VAULT_KEY_2: b64(k2) })!;

  it("seals with the highest-numbered key and opens with every one", () => {
    expect(during.current.key).toEqual(k2);
    expect(during.all.map((e) => e.key)).toEqual([k2, k1]);
    const ring = vaultKey({ PRISM_VAULT_KEY_10: b64(k3), PRISM_VAULT_KEY: b64(k1), PRISM_VAULT_KEY_2: b64(k2) })!;
    expect(ring.all.map((e) => e.key)).toEqual([k3, k2, k1]);
  });

  it("keeps opening what the old key sealed, until that key is deleted", () => {
    const old = sealJson({ accessToken: "access-1" }, before);
    expect(openJson(old, during)).toEqual({ accessToken: "access-1" });
    expect(openJson(old, after)).toBeNull();
    const oldSync = sealPacked({ cursor: "c-1" }, before);
    expect(openPacked(oldSync, during)).toEqual({ cursor: "c-1" });
    expect(openPacked(oldSync, after)).toBeNull();
    const vaultCookie = seal(vault, before);
    expect(open(vaultCookie, during)).toEqual(vault);
  });

  it("opens seals made before seals named their key, under any key in the ring", () => {
    expect(openJson(legacyJson({ accessToken: "access-1" }, k1), during)).toEqual({ accessToken: "access-1" });
    expect(openPacked(legacyPacked({ cursor: "c-1" }, k1), during)).toEqual({ cursor: "c-1" });
    expect(openJson(legacyJson({ accessToken: "access-1" }, k1), after)).toBeNull();
    expect(openPacked(legacyPacked({ cursor: "c-1" }, k1), after)).toBeNull();
  });

  it("changes nothing with one key: seals as the previous release did, so rolling back still reads them", () => {
    const sealed = sealJson({ accessToken: "access-1" }, before);
    expect(sealed).not.toContain(".");
    expect(legacyOpenJson(sealed, k1)).toEqual({ accessToken: "access-1" });
    const packed = sealPacked({ cursor: "c-1" }, before);
    expect(packed.startsWith("z1.")).toBe(true);
    expect(legacyOpenPacked(packed, k1)).toEqual({ cursor: "c-1" });
    expect(needsReseal(legacyJson({ a: 1 }, k1), before)).toBe(false);
    expect(needsReseal(sealed, before)).toBe(false);
  });

  it("names the new key on every seal while a rotation is under way", () => {
    expect(sealJson({ a: 1 }, during).startsWith(`j2.${keyId(k2)}.`)).toBe(true);
    const packed = sealPacked({ cursor: "c-1" }, during);
    expect(packed.startsWith(`z2.${keyId(k2)}.`)).toBe(true);
    expect(Buffer.from(packed.split(".")[2]!, "base64url").toString("latin1")).not.toContain("c-1");
    const [prefix, id, body] = packed.split(".");
    const flipped = `${prefix}.${id}.${Buffer.from(Buffer.from(body!, "base64url").map((b, i) => (i === 20 ? b ^ 1 : b))).toString("base64url")}`;
    expect(openPacked(flipped, during)).toBeNull();
  });

  it("says which seals the new key should make again, without opening anything", () => {
    expect(needsReseal(sealJson({ a: 1 }, before), during)).toBe(true);
    expect(needsReseal(sealPacked({ a: 1 }, before), during)).toBe(true);
    expect(needsReseal(legacyJson({ a: 1 }, k2), during)).toBe(true);
    expect(needsReseal(legacyPacked({ a: 1 }, k2), during)).toBe(true);
    expect(needsReseal(sealJson({ a: 1 }, during), during)).toBe(false);
    expect(needsReseal(sealPacked({ a: 1 }, during), after)).toBe(false);
    for (const nothing of [null, undefined, ""]) expect(needsReseal(nothing, during)).toBe(false);
  });

  it("names a key without revealing it", () => {
    const sealed = sealJson({ a: 1 }, during);
    expect(sealed.startsWith(`j2.${keyId(k2)}.`)).toBe(true);
    expect(keyId(k2)).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(keyId(k2)).not.toBe(keyId(k1));
    expect(b64(k2)).not.toContain(keyId(k2));
    expect(k2.toString("base64url")).not.toContain(keyId(k2));
  });

  it("trusts only the key a seal names, so a seal relabelled to another key doesn't open", () => {
    const sealed = sealJson({ a: 1 }, during);
    const relabelled = sealed.replace(keyId(k2), keyId(k1));
    expect(openJson(relabelled, during)).toBeNull();
    expect(openJson(sealed.replace(keyId(k2), "AAAAAAAA"), during)).toBeNull();
  });

  it("refuses a key that isn't 32 bytes, naming the variable and never the value", () => {
    const short = Buffer.alloc(16, 9).toString("base64");
    expect(() => vaultKey({ PRISM_VAULT_KEY: b64(k1), PRISM_VAULT_KEY_2: short })).toThrow(/^PRISM_VAULT_KEY_2 must be 32 bytes/);
    try {
      vaultKey({ PRISM_VAULT_KEY_2: short });
    } catch (e) {
      expect(String(e)).not.toContain(short);
    }
  });

  it("refuses a replacement that is the old key again", () => {
    expect(() => vaultKey({ PRISM_VAULT_KEY: b64(k1), PRISM_VAULT_KEY_2: b64(k1) })).toThrow(/same key/);
  });

  it("ignores names that aren't vault keys, so a typo can't become one", () => {
    for (const name of ["PRISM_VAULT_KEY2", "PRISM_VAULT_KEY_1", "PRISM_VAULT_KEY_0", "PRISM_VAULT_KEY_02", "PRISM_VAULT_KEY_100", "PRISM_VAULT_KEY_NEW", "prism_vault_key_2"]) {
      expect(vaultKey({ PRISM_VAULT_KEY: b64(k1), [name]: b64(k2) })?.all.map((e) => e.key)).toEqual([k1]);
    }
  });

  it("still requires a key in production once the only one is deleted", () => {
    expect(vaultKey({ PLAID_ENV: "production", PLAID_SECRET: "s", PRISM_VAULT_KEY: "" })).toBeNull();
    expect(vaultKey({ PLAID_ENV: "production", PRISM_VAULT_KEY_3: b64(k3) })?.current.key).toEqual(k3);
  });
});
