import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cookieOptions, emptyVault, open, openPacked, seal, sealJson, sealPacked, type Vault, vaultKey } from "./vault";

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
    expect(vaultKey({ PRISM_VAULT_KEY: key.toString("base64") })).toEqual(key);
  });

  it("derives a sandbox-only key from the Plaid secret", () => {
    const a = vaultKey({ PLAID_SECRET: "sandbox-secret" });
    expect(a).toHaveLength(32);
    expect(vaultKey({ PLAID_SECRET: "sandbox-secret" })).toEqual(a);
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
    for (const junk of [null, undefined, "", "z1.", "z1.%%%", "nope"]) expect(openPacked(junk, key)).toBeNull();
  });
});
