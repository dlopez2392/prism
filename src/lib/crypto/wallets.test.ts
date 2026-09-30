import { describe, expect, it } from "vitest";
import { amountOf, assetAmountText, FRESH_MS, priced, readAgo, validWallets, walletMoney, walletsInstitution, walletStale, type Wallet } from "./wallets";

const NOW = Date.parse("2026-09-30T18:00:00Z");
const wallet = (over: Partial<Wallet> = {}): Wallet => ({
  id: "a1b2c3d4e5f6",
  chain: "bitcoin",
  address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
  name: "Cold storage",
  reading: {
    at: "2026-09-30T17:55:00.000Z",
    assets: [{ symbol: "BTC", name: "Bitcoin", units: "5120000", decimals: 8, usd: 428_000 }],
  },
  ...over,
});

describe("amounts", () => {
  it("turns smallest units into amounts without losing the digits that matter", () => {
    expect(amountOf({ units: "5120000", decimals: 8 })).toBe(0.0512);
    expect(amountOf({ units: "2000000000000000000", decimals: 18 })).toBe(2);
    expect(amountOf({ units: "7", decimals: 0 })).toBe(7);
    expect(amountOf({ units: "0", decimals: 9 })).toBe(0);
    expect(assetAmountText({ symbol: "BTC", units: "5120000", decimals: 8 })).toBe("0.0512 BTC");
    expect(assetAmountText({ symbol: "USDC", units: "7812500", decimals: 6 })).toBe("7.81 USDC");
  });

  it("prices each asset at Coinbase's rate, and leaves one with no rate unpriced rather than $0", () => {
    const rates = { BTC: 1 / 83_593, USDC: 1 };
    expect(priced([{ symbol: "BTC", name: "Bitcoin", units: "5120000", decimals: 8 }, { symbol: "XYZ", name: "Other", units: "1", decimals: 0 }], rates)).toEqual([
      { symbol: "BTC", name: "Bitcoin", units: "5120000", decimals: 8, usd: 427_996 },
      { symbol: "XYZ", name: "Other", units: "1", decimals: 0, usd: null },
    ]);
  });
});

describe("a wallet on Net worth", () => {
  it("is a crypto account named by the person, marked by its address's last four, with a holding per asset", () => {
    const { account, holdings } = walletMoney(wallet());
    expect(account).toEqual({ id: "wallet-a1b2c3d4e5f6", institutionId: "wallets", name: "Cold storage", mask: "f3t4", kind: "crypto", balance: 428_000, history: [428_000], source: "wallet" });
    expect(holdings).toEqual([{ symbol: "BTC", name: "Bitcoin", assetClass: "Crypto", value: 428_000, costBasis: 428_000, accountId: "wallet-a1b2c3d4e5f6" }]);
    expect(walletMoney(wallet({ reading: null })).account.balance).toBe(0);
  });

  it("is read again once its reading is 15 minutes old, and the institution says when any couldn't be read", () => {
    expect(walletStale(wallet(), NOW)).toBe(false);
    expect(walletStale(wallet(), NOW + FRESH_MS)).toBe(true);
    expect(walletStale(wallet({ reading: null }), NOW)).toBe(true);
    expect(walletsInstitution([wallet()])).toMatchObject({ name: "Your wallets", health: "healthy", lastSyncedAt: "2026-09-30T17:55:00.000Z", source: "wallet" });
    expect(walletsInstitution([wallet(), wallet({ id: "ffffffff0000", reading: null })]).health).toBe("needs_attention");
    expect(readAgo("2026-09-30T17:55:00.000Z", NOW)).toBe("5 minutes ago");
    expect(readAgo("2026-09-30T17:59:40.000Z", NOW)).toBe("just now");
    expect(readAgo("2026-09-30T15:00:00.000Z", NOW)).toBe("3 hours ago");
    expect(readAgo("2026-09-28T18:00:00.000Z", NOW)).toBe("2 days ago");
  });
});

describe("what's stored", () => {
  it("keeps each valid wallet on its own, never an address twice, and drops a reading that doesn't add up", () => {
    const stored = {
      v: 1,
      wallets: [
        wallet(),
        wallet({ id: "b2b2b2b2b2b2" }), // the same address again
        wallet({ id: "c3c3c3c3c3c3", chain: "ethereum", address: "0x52908400098527886E0F7030069857D2E4169EE7" }), // not as Prism keeps it
        wallet({ id: "d4d4d4d4d4d4", chain: "ethereum", address: "0x52908400098527886e0f7030069857d2e4169ee7", reading: { at: "yesterday", assets: [] } }),
        wallet({ id: "e5", address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" }), // id too short
      ],
    };
    expect(validWallets(stored)).toEqual([wallet(), { ...wallet({ id: "d4d4d4d4d4d4", chain: "ethereum", address: "0x52908400098527886e0f7030069857d2e4169ee7" }), reading: null }]);
    expect(validWallets({ v: 2, wallets: [wallet()] })).toEqual([]);
  });
});
