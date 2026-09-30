// Crypto wallets (wallet-actions.ts, wallets.ts, account-store.ts): added only
// with an address a network would accept, read straight away, kept sealed, read
// again only when stale, and a reading never written over a newer change.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Wallet } from "@/lib/crypto/wallets";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
const signedIn = { current: null as unknown };
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => signedIn.current }));

const { addWallet, removeWallet } = await import("./wallet-actions");
const { readWallets } = await import("./wallets");
const { saveWalletReadings } = await import("./account-store");
const { openPacked, sealPacked, vaultKey } = await import("./vault");

const KEY = randomBytes(32);
const IDLE = { status: "idle" as const };
const BTC = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const NOW = Date.parse("2026-09-30T18:00:00Z");

function profileDb(wallets: Wallet[] | null, { afterRead }: { afterRead?: (row: Record<string, string | null>) => void } = {}) {
  const row: Record<string, string | null> = { sealed_wallets: wallets ? sealPacked({ v: 1, wallets }, KEY) : null, updated_at: "2026-09-30T17:00:00Z" };
  const writes: { op: string; values: Record<string, unknown>; guard?: unknown }[] = [];
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            const data = { ...row };
            afterRead?.(row);
            return { data, error: null };
          },
        }),
      }),
      upsert: async (values: Record<string, unknown>) => (writes.push({ op: "upsert", values }), Object.assign(row, values), { error: null }),
      update: (values: Record<string, unknown>) => ({
        eq: () => ({
          eq: async (_col: string, was: unknown) => {
            writes.push({ op: "update", values, guard: was });
            if (was !== row.updated_at) return { error: null, count: 0 };
            Object.assign(row, values);
            return { error: null, count: 1 };
          },
        }),
      }),
    }),
  };
  const account = { userId: "u1", email: "a@x.test", supabase: db };
  signedIn.current = account;
  return { row, writes, account: account as never, wallets: () => (row.sealed_wallets ? (openPacked(row.sealed_wallets, KEY) as { wallets: Wallet[] }).wallets : []) };
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

/** mempool.space for balances, Coinbase for prices. */
const services = ({ btcUnits = 5_120_000, rates = true, balances = true } = {}) => {
  const f = vi.fn<typeof fetch>(async (url) => {
    const u = String(url);
    if (u.startsWith("https://api.coinbase.com/")) return rates ? new Response(JSON.stringify({ data: { rates: { BTC: String(1 / 83_593) } } })) : new Response("", { status: 503 });
    if (u.startsWith("https://mempool.space/api/address/"))
      return balances ? new Response(JSON.stringify({ chain_stats: { funded_txo_sum: btcUnits, spent_txo_sum: 0 } })) : new Response("", { status: 502 });
    throw new Error(`unexpected request: ${u}`);
  });
  vi.stubGlobal("fetch", f);
  return f;
};

const kept = (over: Partial<Wallet> = {}): Wallet => ({
  id: "a1b2c3d4e5f6",
  chain: "bitcoin",
  address: BTC,
  name: "Cold storage",
  reading: { at: "2026-09-30T17:55:00.000Z", assets: [{ symbol: "BTC", name: "Bitcoin", units: "5000000", decimals: 8, usd: 417_965 }] },
  ...over,
});

beforeEach(() => vi.stubEnv("PRISM_VAULT_KEY", KEY.toString("base64")));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  signedIn.current = null;
});

describe("adding a wallet", () => {
  it("checks the address in full, reads it straight away, and keeps it sealed", async () => {
    const db = profileDb(null);
    const f = services();
    const r = await addWallet(IDLE, form({ chain: "bitcoin", address: ` ${BTC.toUpperCase()} `, name: "" }));
    expect(r).toMatchObject({ status: "saved", message: "Bitcoin wallet added: $4,280 today." });
    const [w] = db.wallets();
    expect(w).toMatchObject({ chain: "bitcoin", address: BTC, name: "Bitcoin wallet", reading: { assets: [{ symbol: "BTC", units: "5120000", usd: 427_996 }] } });
    expect(w!.id).toMatch(/^[0-9a-f]{12}$/);
    // Sealed: the address isn't in the row, and the only requests carried the address alone.
    expect(db.row.sealed_wallets).not.toContain("w508d6");
    expect(f.mock.calls.map(([u]) => String(u)).sort()).toEqual([`https://api.coinbase.com/v2/exchange-rates?currency=USD`, `https://mempool.space/api/address/${BTC}`]);
  });

  it("keeps an address it can't read yet, and says so", async () => {
    const db = profileDb(null);
    services({ balances: false });
    expect(await addWallet(IDLE, form({ chain: "bitcoin", address: BTC, name: "New wallet" }))).toMatchObject({ status: "saved", message: expect.stringMatching(/couldn't read its balance just now/) });
    expect(db.wallets()[0]!.reading).toBeNull();
  });

  it("refuses a mistyped address, a network that isn't on, a wallet already there, and an eleventh", async () => {
    const db = profileDb([kept()]);
    const f = services();
    expect(await addWallet(IDLE, form({ chain: "bitcoin", address: BTC.slice(0, -1) + "5", name: "" }))).toMatchObject({ status: "error", fields: { address: expect.stringMatching(/isn't a Bitcoin address/) } });
    expect(await addWallet(IDLE, form({ chain: "ethereum", address: "0x52908400098527886E0F7030069857D2E4169EE7", name: "" }))).toMatchObject({ status: "error", message: "Ethereum wallets aren't switched on yet." });
    expect(await addWallet(IDLE, form({ chain: "dogecoin", address: BTC, name: "" }))).toMatchObject({ status: "error", fields: { chain: expect.any(String) } });
    expect(await addWallet(IDLE, form({ chain: "bitcoin", address: BTC, name: "" }))).toMatchObject({ status: "error", message: "That wallet is already in Prism." });
    expect(f).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
    // Ten stored wallets (their addresses need only look like one to be kept; each ends in a different bech32 character).
    const ten = Array.from({ length: 10 }, (_, i) => kept({ id: `ffffffff000${i}`, address: `bc1q${"x".repeat(20)}${"qpzry9x8gf"[i]}` }));
    profileDb(ten);
    expect(await addWallet(IDLE, form({ chain: "bitcoin", address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", name: "" }))).toMatchObject({ status: "error", message: expect.stringMatching(/up to 10 wallets/) });
  });

  it("needs a signed-in account", async () => {
    expect(await addWallet(IDLE, form({ chain: "bitcoin", address: BTC, name: "" }))).toMatchObject({ status: "error", message: expect.stringMatching(/Sign in/) });
  });
});

describe("removing a wallet", () => {
  it("takes its address out of the account, and only its own", async () => {
    const db = profileDb([kept(), kept({ id: "b2b2b2b2b2b2", address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", name: "Old one" })]);
    expect(await removeWallet(IDLE, form({ id: "a1b2c3d4e5f6" }))).toMatchObject({ status: "saved" });
    expect(db.wallets().map((w) => w.name)).toEqual(["Old one"]);
    profileDb([]);
    expect(await removeWallet(IDLE, form({ id: "a1b2c3d4e5f6" }))).toMatchObject({ status: "error" });
  });
});

describe("reading wallets on a visit", () => {
  it("reads only the stale ones, and keeps the last reading when a price or a balance can't be had", async () => {
    const fresh = kept();
    const stale = kept({ id: "b2b2b2b2b2b2", address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", reading: { ...kept().reading!, at: "2026-09-30T17:00:00.000Z" } });
    const f = services({ btcUnits: 10_000_000 });
    const r = await readWallets([fresh, stale], { now: NOW });
    expect(f.mock.calls.map(([u]) => String(u))).toContain("https://mempool.space/api/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
    expect(f.mock.calls.map(([u]) => String(u))).not.toContain(`https://mempool.space/api/address/${BTC}`);
    expect([...r.fresh.keys()]).toEqual(["b2b2b2b2b2b2"]);
    expect(r.wallets[1]!.reading).toEqual({ at: "2026-09-30T18:00:00.000Z", assets: [{ symbol: "BTC", name: "Bitcoin", units: "10000000", decimals: 8, usd: 835_930 }] });

    services({ rates: false });
    expect((await readWallets([stale], { now: NOW })).wallets).toEqual([stale]);
    services({ balances: false });
    expect((await readWallets([stale], { now: NOW })).fresh.size).toBe(0);
    // Ethereum without the key isn't even asked.
    const f2 = services();
    await readWallets([kept({ id: "c3c3c3c3c3c3", chain: "ethereum", address: "0x52908400098527886e0f7030069857d2e4169ee7", reading: null })], { now: NOW, env: {} });
    expect(f2).not.toHaveBeenCalled();
  });

  it("keeps a new reading only over the account as it was read, and only for a wallet still at that address", async () => {
    const key = () => vaultKey()!;
    const reading = { at: "2026-09-30T18:00:00.000Z", assets: [] };
    const db = profileDb([kept()]);
    expect(await saveWalletReadings(db.account, new Map([["a1b2c3d4e5f6", { address: BTC, reading }]]), key())).toBe(true);
    expect(db.wallets()[0]!.reading).toEqual(reading);
    // The person added a wallet in another tab between the read and the write: that write stands, the reading waits.
    const added = kept({ id: "b2b2b2b2b2b2", address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", name: "Added meanwhile" });
    const raced = profileDb([kept()], {
      afterRead: (row) => Object.assign(row, { sealed_wallets: sealPacked({ v: 1, wallets: [kept(), added] }, KEY), updated_at: "2026-09-30T17:59:59Z" }),
    });
    expect(await saveWalletReadings(raced.account, new Map([["a1b2c3d4e5f6", { address: BTC, reading }]]), key())).toBe(false);
    expect(raced.wallets().map((w) => w.name)).toEqual(["Cold storage", "Added meanwhile"]);
    // A wallet re-added at another address under the same id gets nothing.
    const other = profileDb([kept({ address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" })]);
    expect(await saveWalletReadings(other.account, new Map([["a1b2c3d4e5f6", { address: BTC, reading }]]), key())).toBe(false);
    expect(other.writes).toEqual([]);
  });
});
