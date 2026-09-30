import { describe, expect, it, vi } from "vitest";
import { BalanceError, chainEnabled, ETHEREUM_TOKENS, readBalances, SOLANA_TOKENS, usdRatesPublic } from "./balances";

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
