import { describe, expect, it, vi } from "vitest";
import { BalanceError, chainEnabled, ETHEREUM_TOKENS, GAP_LIMIT, MAX_ADDRESS_INDEX, readBalances, readWholeWallet, SOLANA_TOKENS, usdRatesPublic } from "./balances";
import type { Script } from "./wallets";
import { parseWalletKey, walletAddresses, type WalletKey } from "./xpub";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const reason = (p: Promise<unknown>) => p.then(() => "none", (e: unknown) => (e instanceof BalanceError ? e.reason : "other"));
const KEYED = { ALCHEMY_API_KEY: "alc-key" };

describe("which networks are on", () => {
  it("reads Bitcoin with no key, and Ethereum and Solana only with the operator's Alchemy key", () => {
    expect(chainEnabled("bitcoin", {})).toBe(true);
    expect(chainEnabled("ethereum", {})).toBe(false);
    expect(chainEnabled("solana", { ALCHEMY_API_KEY: " " })).toBe(false);
    expect(chainEnabled("ethereum", KEYED)).toBe(true);
  });
});

describe("a Bitcoin address", () => {
  it("holds its confirmed coins, asked of mempool.space by address alone", async () => {
    const f = vi.fn<typeof fetch>(async () => json({ chain_stats: { funded_txo_sum: 5_747_664_382, spent_txo_sum: 1_000 }, mempool_stats: { funded_txo_sum: 11_375, spent_txo_sum: 0 } }));
    expect(await readBalances("bitcoin", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", {}, f)).toEqual([{ symbol: "BTC", name: "Bitcoin", units: "5747663382", decimals: 8 }]);
    expect(String(f.mock.calls[0]![0])).toBe("https://mempool.space/api/address/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
  });

  it("says why when it can't be read", async () => {
    const ask = (f: typeof fetch) => reason(readBalances("bitcoin", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", {}, f));
    expect(await ask(vi.fn(async () => json({ error: "bad" }, 400)))).toBe("refused");
    expect(await ask(vi.fn(async () => json({}, 429)))).toBe("unavailable");
    expect(await ask(vi.fn(async () => json({ chain_stats: { funded_txo_sum: 1, spent_txo_sum: 2 } })))).toBe("unavailable");
    expect(await ask(vi.fn(async () => Promise.reject(new TypeError("fetch failed"))))).toBe("unavailable");
  });
});

describe("an Ethereum address", () => {
  const ADDRESS = "0x52908400098527886e0f7030069857d2e4169ee7";

  it("holds its ETH and only the listed tokens, named by contract, never by what a token calls itself", async () => {
    const f = vi.fn<typeof fetch>(async (_url, init) => {
      const call = JSON.parse(String(init!.body)) as { id: number; method: string; params: unknown[] };
      if (call.method === "eth_getBalance") return json({ jsonrpc: "2.0", id: call.id, result: "0x1bc16d674ec80000" }); // 2 ETH
      return json({
        jsonrpc: "2.0",
        id: call.id,
        result: {
          address: ADDRESS,
          tokenBalances: [
            { contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", tokenBalance: "0x00000000000000000000000000000000000000000000000000000000773594" }, // 7.81 USDC
            { contractAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7", tokenBalance: "0x0" },
            // A token that says it's USDC, at an address that isn't: never counted.
            { contractAddress: "0x000000000000000000000000000000000000dead", tokenBalance: "0xffffffff" },
          ],
        },
      });
    });
    expect(await readBalances("ethereum", ADDRESS, KEYED, f)).toEqual([
      { symbol: "ETH", name: "Ether", units: "2000000000000000000", decimals: 18 },
      { symbol: "USDC", name: "USD Coin", units: "7812500", decimals: 6 },
    ]);
    const calls = f.mock.calls.map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init!.body)) as { method: string; params: unknown[] } }));
    expect(calls.map((c) => c.url)).toEqual(["https://eth-mainnet.g.alchemy.com/v2/alc-key", "https://eth-mainnet.g.alchemy.com/v2/alc-key"]);
    expect(calls.map((c) => c.body.method).sort()).toEqual(["alchemy_getTokenBalances", "eth_getBalance"]);
    expect(calls.find((c) => c.body.method === "alchemy_getTokenBalances")!.body.params).toEqual([ADDRESS, ETHEREUM_TOKENS.map((t) => t.contract)]);
  });

  it("is never asked without a key, and an error from the service is no reading", async () => {
    expect(await reason(readBalances("ethereum", ADDRESS, {}, vi.fn()))).toBe("refused");
    expect(await reason(readBalances("ethereum", ADDRESS, KEYED, vi.fn(async () => json({ jsonrpc: "2.0", id: 0, error: { code: -32000 } }))))).toBe("unavailable");
  });
});

describe("a Solana address", () => {
  const ADDRESS = "So11111111111111111111111111111111111111112";

  it("holds its SOL and the listed tokens by mint, summed across token accounts", async () => {
    const f = vi.fn<typeof fetch>(async (_url, init) => {
      const call = JSON.parse(String(init!.body)) as { id: number; method: string; params: [string, { mint?: string }] };
      if (call.method === "getBalance") return json({ jsonrpc: "2.0", id: call.id, result: { context: { slot: 1 }, value: 2_500_000_000 } });
      const mint = call.params[1].mint;
      const accounts =
        mint === SOLANA_TOKENS[0]!.mint
          ? [1_000_000, 500_000].map((amount) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { amount: String(amount), decimals: 6 } } } } } }))
          : [];
      return json({ jsonrpc: "2.0", id: call.id, result: { context: { slot: 1 }, value: accounts } });
    });
    expect(await readBalances("solana", ADDRESS, KEYED, f)).toEqual([
      { symbol: "SOL", name: "Solana", units: "2500000000", decimals: 9 },
      { symbol: "USDC", name: "USD Coin", units: "1500000", decimals: 6 },
    ]);
    expect(new Set(f.mock.calls.map(([url]) => String(url)))).toEqual(new Set(["https://solana-mainnet.g.alchemy.com/v2/alc-key"]));
  });
});

describe("prices", () => {
  it("are Coinbase's public USD rates, asked with nothing about anyone", async () => {
    const f = vi.fn<typeof fetch>(async () => json({ data: { currency: "USD", rates: { BTC: "0.0000119629", ETH: "0.000373", JUNK: "abc", ZERO: "0" } } }));
    expect(await usdRatesPublic(f)).toEqual({ BTC: 0.0000119629, ETH: 0.000373 });
    expect(String(f.mock.calls[0]![0])).toBe("https://api.coinbase.com/v2/exchange-rates?currency=USD");
  });
});

describe("a whole Bitcoin wallet, by its extended public key", () => {
  // BIP 84's zpub and BIP 86's xpub (the test wallet every BIP uses; it holds nothing).
  const ZPUB = parseWalletKey("zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs") as WalletKey;
  const XPUB = parseWalletKey("xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ") as WalletKey;

  type Held = { funded?: number; spent?: number; txs?: number; waiting?: number };
  /** mempool.space for a few known addresses; every other address has never been used. */
  const ledger = (key: string, held: [Script, 0 | 1, number, Held][], answer?: (address: string) => Response | undefined) => {
    const at = walletAddresses(key);
    const byAddress = new Map(held.map(([script, change, i, h]) => [at(script, change, i), h]));
    return vi.fn<typeof fetch>(async (url) => {
      const address = String(url).replace("https://mempool.space/api/address/", "");
      const special = answer?.(address);
      if (special) return special;
      const h = byAddress.get(address) ?? {};
      const funded = h.funded ?? 0;
      return json({
        address,
        chain_stats: { funded_txo_sum: funded, spent_txo_sum: h.spent ?? 0, tx_count: h.txs ?? (funded > 0 ? 1 : 0) },
        mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: h.waiting ?? 0 },
      });
    });
  };
  const asked = (f: ReturnType<typeof vi.fn<typeof fetch>>) => f.mock.calls.map(([u]) => String(u).replace("https://mempool.space/api/address/", ""));

  it("reads every address until twenty in a row are unused, on both sides, and asks about addresses alone", async () => {
    const f = ledger(ZPUB.key, [
      ["p2wpkh", 0, 0, { funded: 100_000, spent: 100_000, txs: 2 }], // used, now empty
      ["p2wpkh", 0, 1, { funded: 250_000 }],
      ["p2wpkh", 0, 5, { funded: 40_000 }],
      ["p2wpkh", 0, 24, { funded: 10_000 }], // past the first twenty: found because 5 was used
      ["p2wpkh", 1, 0, { funded: 60_000 }], // change
    ]);
    const r = await readWholeWallet(ZPUB.key, ZPUB.scripts, f);
    expect(r).toEqual({ assets: [{ symbol: "BTC", name: "Bitcoin", units: "360000", decimals: 8 }], used: 5, scripts: ["p2wpkh"] });
    const at = walletAddresses(ZPUB.key);
    const urls = asked(f);
    // Receiving 0–44 (twenty past the last used, 24) and change 0–20, each once; never 45.
    expect(urls.length).toBe(45 + 21);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toContain(at("p2wpkh", 0, 44));
    expect(urls).not.toContain(at("p2wpkh", 0, 45));
    expect(urls).not.toContain(at("p2wpkh", 1, 21));
    // Only addresses: the key never leaves Prism, in any form.
    for (const u of f.mock.calls.map(([u]) => String(u))) expect(u).toMatch(/^https:\/\/mempool\.space\/api\/address\/bc1q[02-9ac-hj-np-z]+$/);
    expect(GAP_LIMIT).toBe(20);
  });

  it("counts a payment still waiting for a block as a used address, but not as money yet", async () => {
    const f = ledger(ZPUB.key, [
      ["p2wpkh", 0, 0, { funded: 50_000 }],
      ["p2wpkh", 0, 18, { waiting: 1 }],
    ]);
    const r = await readWholeWallet(ZPUB.key, ZPUB.scripts, f);
    expect(r.assets[0]!.units).toBe("50000");
    expect(r.used).toBe(2);
    expect(asked(f)).toContain(walletAddresses(ZPUB.key)("p2wpkh", 0, 38));
  });

  it("finds which kind of address a bare xpub pays to from its history, and waits while it has none", async () => {
    const f = ledger(XPUB.key, [["p2tr", 0, 0, { funded: 70_000 }]]);
    expect(await readWholeWallet(XPUB.key, [], f)).toMatchObject({ used: 1, scripts: ["p2tr"], assets: [{ units: "70000" }] });
    // The first address of each kind was checked, once each.
    const at = walletAddresses(XPUB.key);
    expect(asked(f)).toEqual(expect.arrayContaining(["p2wpkh", "p2tr", "p2sh-p2wpkh", "p2pkh"].map((s) => at(s as Script, 0, 0))));
    expect(asked(f).filter((u) => u === at("p2tr", 0, 0))).toHaveLength(1);

    const unused = ledger(XPUB.key, []);
    expect(await readWholeWallet(XPUB.key, [], unused)).toEqual({ assets: [{ symbol: "BTC", name: "Bitcoin", units: "0", decimals: 8 }], used: 0, scripts: [] });
    expect(unused).toHaveBeenCalledTimes(4);
  });

  it("is all or nothing: one unreadable address means no reading, and nothing more is asked", async () => {
    const at = walletAddresses(ZPUB.key);
    const f = ledger(ZPUB.key, [["p2wpkh", 0, 0, { funded: 1 }]], (a) => (a === at("p2wpkh", 0, 3) ? json({}, 503) : undefined));
    expect(await reason(readWholeWallet(ZPUB.key, ZPUB.scripts, f))).toBe("unavailable");
    expect(f.mock.calls.length).toBeLessThan(21 + 21);
    // An answer without a transaction count can't place the gap limit.
    const vague = vi.fn<typeof fetch>(async () => json({ chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 } }));
    expect(await reason(readWholeWallet(ZPUB.key, ZPUB.scripts, vague))).toBe("unavailable");
    // Past its deadline, nothing is asked at all.
    const late = ledger(ZPUB.key, []);
    expect(await reason(readWholeWallet(ZPUB.key, ZPUB.scripts, late, AbortSignal.abort()))).toBe("unavailable");
    expect(late).not.toHaveBeenCalled();
  });

  it("refuses a wallet with more addresses than Prism reads, rather than half-reading it", async () => {
    let calls = 0;
    const everything = vi.fn<typeof fetch>(async () => {
      // Without the limit this wallet never ends: fail loudly instead of hanging.
      if (++calls > 4 * (MAX_ADDRESS_INDEX + GAP_LIMIT)) throw new Error("read past the limit");
      return json({ chain_stats: { funded_txo_sum: 1, spent_txo_sum: 0, tx_count: 1 }, mempool_stats: { tx_count: 0 } });
    });
    expect(await reason(readWholeWallet(ZPUB.key, ZPUB.scripts, everything))).toBe("too-large");
    const at = walletAddresses(ZPUB.key);
    expect(asked(everything)).not.toContain(at("p2wpkh", 0, MAX_ADDRESS_INDEX + 1));
  });
});
