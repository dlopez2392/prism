import { describe, expect, it } from "vitest";
import type { CoinbaseAccount } from "./client";
import { coinbaseNeedsSignIn, mapCoinbase, sharedCoinbase, toUsdCents, validCoinbaseValue } from "./map";

const wallet = (code: string, amount: string, opts: { type?: string; fiat?: boolean; name?: string } = {}): CoinbaseAccount => ({
  id: `${code}-${amount}`,
  name: `${code} Wallet`,
  type: opts.type ?? (opts.fiat ? "fiat" : "wallet"),
  currency: { code, name: opts.name ?? code, type: opts.fiat ? "fiat" : "crypto" },
  balance: { amount, currency: code },
});

// Units per dollar: BTC at $64,000, ETH at $3,200.
const rates = { USD: 1, BTC: 1 / 64_000, ETH: 1 / 3_200 };
const SYNCED = "2026-09-28T09:00:00.000Z";

describe("toUsdCents", () => {
  it("prices units through units-per-dollar", () => {
    expect(toUsdCents(0.5, 1 / 64_000)).toBe(3_200_000);
    expect(toUsdCents(12.34, 1)).toBe(1_234);
  });
});

describe("mapCoinbase", () => {
  it("makes one crypto account worth everything held, with a holding per currency", () => {
    const snap = mapCoinbase([wallet("BTC", "0.25", { name: "Bitcoin" }), wallet("ETH", "2", { name: "Ethereum" }), wallet("USD", "150.00", { fiat: true, name: "US Dollar" })], rates, SYNCED);
    expect(snap.holdings).toEqual([
      { symbol: "BTC", name: "Bitcoin", assetClass: "Crypto", value: 1_600_000, costBasis: 1_600_000, accountId: "coinbase" },
      { symbol: "ETH", name: "Ethereum", assetClass: "Crypto", value: 640_000, costBasis: 640_000, accountId: "coinbase" },
      { symbol: "USD", name: "US Dollar", assetClass: "Cash", value: 15_000, costBasis: 15_000, accountId: "coinbase" },
    ]);
    expect(snap.account).toEqual({
      id: "coinbase",
      institutionId: "coinbase",
      name: "Coinbase",
      mask: null,
      kind: "crypto",
      balance: 2_255_000,
      history: [2_255_000],
      source: "coinbase",
    });
    expect(snap.institution).toEqual({ id: "coinbase", name: "Coinbase", health: "healthy", lastSyncedAt: SYNCED, source: "coinbase" });
  });

  it("adds a currency's wallet and vault together", () => {
    const snap = mapCoinbase([wallet("BTC", "0.1"), wallet("BTC", "0.15", { type: "vault" })], rates, SYNCED);
    expect(snap.holdings).toHaveLength(1);
    expect(snap.holdings[0]!.value).toBe(1_600_000);
  });

  it("drops empty wallets and dust, and never guesses a price", () => {
    const snap = mapCoinbase([wallet("DOGE", "0"), wallet("ETH", "0.000000001"), wallet("NEWCOIN", "500"), wallet("BTC", "garbage")], rates, SYNCED);
    expect(snap.holdings).toEqual([]);
    expect(snap.account.balance).toBe(0);
    expect(snap.unpriced).toEqual(["NEWCOIN"]);
  });

  it("marks a dead link for a fresh sign-in", () => {
    expect(coinbaseNeedsSignIn()).toMatchObject({ id: "coinbase", health: "needs_attention", lastSyncedAt: null });
  });
});

describe("a shared Coinbase's value", () => {
  it("reads back only a whole, non-negative number of cents, all or nothing", () => {
    expect(validCoinbaseValue({ v: 1, balance: 12_345 })).toEqual({ v: 1, balance: 12_345 });
    expect(validCoinbaseValue({ v: 1, balance: 0 })).toEqual({ v: 1, balance: 0 });
    for (const bad of [null, "12", { v: 2, balance: 1 }, { v: 1, balance: -1 }, { v: 1, balance: 1.5 }, { v: 1, balance: "1" }, { v: 1, balance: 1e20 }]) {
      expect(validCoinbaseValue(bad)).toBeNull();
    }
  });

  it("becomes one account and one honest point, as of the owner's last visit", () => {
    const { institution, account } = sharedCoinbase({ v: 1, balance: 900 }, "2026-09-30T08:00:00Z");
    expect(institution).toMatchObject({ id: "coinbase", name: "Coinbase", lastSyncedAt: "2026-09-30T08:00:00Z", source: "coinbase" });
    expect(account).toMatchObject({ id: "coinbase", kind: "crypto", balance: 900, history: [900] });
  });
});
