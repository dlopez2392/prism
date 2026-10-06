// Crypto wallets (wallet-actions.ts, wallets.ts, account-store.ts): added only
// with an address a network would accept, read straight away, kept sealed, read
// again only when stale, and a reading never written over a newer change.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Wallet } from "@/lib/crypto/wallets";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/i18n/server", async () => ({ getT: async () => (await import("@/lib/i18n/t")).EN }));
const signedIn = { current: null as unknown };
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => signedIn.current }));

const { addWallet, removeWallet } = await import("./wallet-actions");
const { readWallets, refreshWholeWallets } = await import("./wallets");
const { claimWalletScans, saveWalletReadings } = await import("./account-store");
const { walletAddresses } = await import("@/lib/crypto/xpub");
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

describe("a whole Bitcoin wallet", () => {
  // BIP 84's test wallet (it holds nothing): its zpub, the same key as Prism keeps it, and its descriptor.
  const ZPUB = "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
  const XPUB = "xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V";
  const BTC_PRICE = 83_593;

  /** Coinbase for prices; mempool.space answering for each of the wallet's native SegWit addresses. */
  const ledger = (held: Record<number, number>) => {
    const at = walletAddresses(XPUB);
    const funded = new Map(Object.entries(held).map(([i, sats]) => [at("p2wpkh", 0, Number(i)), sats]));
    const f = vi.fn<typeof fetch>(async (url) => {
      const u = String(url);
      if (u.startsWith("https://api.coinbase.com/")) return new Response(JSON.stringify({ data: { rates: { BTC: String(1 / BTC_PRICE) } } }));
      if (u.startsWith("https://mempool.space/api/address/")) {
        const sats = funded.get(u.slice("https://mempool.space/api/address/".length)) ?? 0;
        return new Response(JSON.stringify({ chain_stats: { funded_txo_sum: sats, spent_txo_sum: 0, tx_count: sats ? 1 : 0 }, mempool_stats: { tx_count: 0 } }));
      }
      throw new Error(`unexpected request: ${u}`);
    });
    vi.stubGlobal("fetch", f);
    return f;
  };
  const sentKey = (f: ReturnType<typeof ledger>) => f.mock.calls.some(([u]) => /[xyz]pub|6rFR7y4Q|CatWdiZi/.test(String(u)));

  it("is read in full when added, kept as one canonical key, and never sent anywhere", async () => {
    const db = profileDb(null);
    const f = ledger({ 0: 1_000_000, 3: 2_000_000 });
    const r = await addWallet(IDLE, form({ chain: "bitcoin", address: ZPUB, name: "" }));
    expect(r).toMatchObject({ status: "saved", message: "Bitcoin wallet added: $2,508 today, across 2 addresses." });
    const [w] = db.wallets();
    expect(w).toMatchObject({ address: XPUB, scripts: ["p2wpkh"], reading: { addresses: 2, assets: [{ symbol: "BTC", units: "3000000", usd: 250_779 }] } });
    expect(sentKey(f)).toBe(false);
    expect(db.row.sealed_wallets).not.toContain("xpub");
    // The same wallet again, as its descriptor: already there.
    expect(await addWallet(IDLE, form({ chain: "bitcoin", address: `wpkh([73c5da0a/84h/0h/0h]${XPUB}/<0;1>/*)`, name: "" }))).toMatchObject({ status: "error", message: "That wallet is already in Prism." });
  });

  it("says so when it hasn't been used, or couldn't be read, and keeps it either way", async () => {
    let db = profileDb(null);
    ledger({});
    expect(await addWallet(IDLE, form({ chain: "bitcoin", address: ZPUB, name: "New" }))).toMatchObject({ message: "New added. It hasn't been used yet, so it counts $0 until bitcoin arrives." });
    db = profileDb(null);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).startsWith("https://api.coinbase.com/") ? new Response(JSON.stringify({ data: { rates: { BTC: "0.00001" } } })) : new Response("", { status: 429 }))));
    expect(await addWallet(IDLE, form({ chain: "bitcoin", address: ZPUB, name: "Busy" }))).toMatchObject({ message: expect.stringMatching(/couldn't read all of its addresses just now/) });
    expect(db.wallets()[0]).toMatchObject({ address: XPUB, reading: null, scripts: ["p2wpkh"] });
  });

  it("refuses anything that can spend, before any request or write, and never repeats it back", async () => {
    const db = profileDb(null);
    const f = ledger({});
    const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const secrets = [
      `xprv${Array.from({ length: 107 }, (_, i) => B58[(i * 7) % 58]).join("")}`,
      Array.from({ length: 12 }, (_, i) => ["river", "stone", "apple"][i % 3]).join(" "),
      `K${Array.from({ length: 51 }, (_, i) => B58[(i * 5) % 58]).join("")}`,
    ];
    for (const secret of secrets) {
      const r = await addWallet(IDLE, form({ chain: "bitcoin", address: secret, name: "" }));
      expect(r).toMatchObject({ status: "error", fields: { address: expect.stringMatching(/Prism didn't keep it/) } });
      expect(JSON.stringify(r)).not.toContain(secret.slice(4, 30));
    }
    expect(f).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it("names a test-network or multisig key instead of reading it", async () => {
    profileDb(null);
    ledger({});
    const tpub = "tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M";
    expect(await addWallet(IDLE, form({ chain: "bitcoin", address: tpub, name: "" }))).toMatchObject({ fields: { address: expect.stringMatching(/test network/) } });
  });

  it("is never read while a page waits: a visit hands it back to read after the response", async () => {
    const f = ledger({});
    const stale: Wallet = { id: "d4d4d4d4d4d4", chain: "bitcoin", address: XPUB, name: "Hardware", reading: null, scripts: ["p2wpkh"] };
    const r = await readWallets([stale], { now: NOW });
    expect(r.later.map((w) => w.id)).toEqual(["d4d4d4d4d4d4"]);
    expect(r.fresh.size).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });

  it("is read by one request at a time: claimed first, read, kept, and not read again until due", async () => {
    const key = () => vaultKey()!;
    const stale: Wallet = { id: "d4d4d4d4d4d4", chain: "bitcoin", address: XPUB, name: "Hardware", reading: null, scripts: [] };
    const db = profileDb([stale]);
    const f = ledger({ 0: 500_000 });
    await refreshWholeWallets(db.account, [stale], key(), { now: NOW });
    expect(db.wallets()[0]).toMatchObject({ scripts: ["p2wpkh"], tried: new Date(NOW).toISOString(), reading: { addresses: 1, assets: [{ units: "500000" }] } });
    // Another page a minute later: already fresh, nothing is asked.
    const asked = f.mock.calls.length;
    await refreshWholeWallets(db.account, [stale], key(), { now: NOW + 60_000 });
    expect(f.mock.calls.length).toBe(asked);

    // Two pages at once: the claim that loses the race reads nothing.
    const raced = profileDb([stale], { afterRead: (row) => Object.assign(row, { updated_at: "2026-09-30T17:59:59Z" }) });
    expect(await claimWalletScans(raced.account, ["d4d4d4d4d4d4"], key(), NOW)).toEqual([]);
    expect(raced.wallets()[0]!.tried).toBeUndefined();
    // A single address is never claimed this way.
    const single = profileDb([kept()]);
    expect(await claimWalletScans(single.account, ["a1b2c3d4e5f6"], key(), NOW)).toEqual([]);
  });
});
