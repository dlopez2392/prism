// src/lib/crypto/balances.ts
//
// What a public address holds, read from a public ledger. Only the address is
// ever sent: no name, no account, nothing else about the person.
//
//   Bitcoin  — mempool.space's public API: confirmed coins only (a payment
//              still waiting for a block isn't counted until it lands). A
//              whole wallet (xpub.ts) is read address by address: Prism
//              works out each address itself and never sends the key.
//   Ethereum — Alchemy (ALCHEMY_API_KEY): ETH, and a short list of well-known
//              tokens named by CONTRACT, never by symbol, because scam tokens
//              copy real names and airdrop themselves into every wallet.
//   Solana   — Alchemy: SOL, and USDC and USDT named by mint.
//
// Ethereum and Solana are off until the operator sets ALCHEMY_API_KEY.
// Pure apart from the requests, which take an injectable fetch.

import { SCRIPTS, type Chain, type Script, type WalletAsset } from "./wallets";
import { walletAddresses } from "./xpub";

type Env = Record<string, string | undefined>;

export const MEMPOOL_API_URL = "https://mempool.space/api";
// A page waits on a stale wallet at most this long; a slower answer is left for the next visit.
const TIMEOUT_MS = 4_000;

/** Tokens counted on Ethereum mainnet, by contract (lowercase). Anything else an address holds is left out. */
export const ETHEREUM_TOKENS: { contract: string; symbol: string; name: string; decimals: number }[] = [
  { contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", name: "USD Coin", decimals: 6 },
  { contract: "0xdac17f958d2ee523a2206206994597c13d831ec7", symbol: "USDT", name: "Tether", decimals: 6 },
  { contract: "0x6b175474e89094c44da98b954eedeac495271d0f", symbol: "DAI", name: "Dai", decimals: 18 },
  { contract: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", symbol: "WBTC", name: "Wrapped Bitcoin", decimals: 8 },
];

/** Tokens counted on Solana, by mint. */
export const SOLANA_TOKENS: { mint: string; symbol: string; name: string; decimals: number }[] = [
  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6 },
  { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", name: "Tether", decimals: 6 },
];

/** Ethereum and Solana need the operator's Alchemy key; Bitcoin needs nothing. */
export function chainEnabled(chain: Chain, env: Env = process.env): boolean {
  return chain === "bitcoin" || (env.ALCHEMY_API_KEY ?? "").trim().length > 0;
}

/** Why there's no reading: an address the service refused, no answer, or a wallet with more addresses than Prism reads. */
export class BalanceError extends Error {
  constructor(readonly reason: "refused" | "unavailable" | "too-large") {
    super(`balance ${reason}`);
    this.name = "BalanceError";
  }
}

async function getJson(fetchImpl: typeof fetch, url: string, init: RequestInit = {}, deadline?: AbortSignal): Promise<unknown> {
  let res: Response;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  try {
    res = await fetchImpl(url, {
      ...init,
      headers: { Accept: "application/json", ...(init.headers ?? {}) },
      signal: deadline ? AbortSignal.any([timeout, deadline]) : timeout,
      cache: "no-store",
    });
  } catch {
    throw new BalanceError("unavailable");
  }
  if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) throw new BalanceError("refused");
  if (!res.ok) throw new BalanceError("unavailable");
  try {
    return await res.json();
  } catch {
    throw new BalanceError("unavailable");
  }
}

const whole = (x: unknown): bigint | null => {
  if (typeof x === "number" && Number.isSafeInteger(x) && x >= 0) return BigInt(x);
  if (typeof x === "string" && /^(0x[0-9a-fA-F]+|\d+)$/.test(x)) return BigInt(x);
  return null;
};

/**
 * One address: its confirmed balance, and whether it has ever been used (a
 * payment still waiting counts). `used` is null when the answer doesn't say,
 * which a single address doesn't need but a whole wallet's gap limit does.
 */
async function bitcoinAddress(address: string, fetchImpl: typeof fetch, deadline?: AbortSignal): Promise<{ confirmed: bigint; used: boolean | null }> {
  const body = (await getJson(fetchImpl, `${MEMPOOL_API_URL}/address/${encodeURIComponent(address)}`, {}, deadline)) as {
    chain_stats?: { funded_txo_sum?: unknown; spent_txo_sum?: unknown; tx_count?: unknown };
    mempool_stats?: { tx_count?: unknown };
  };
  const funded = whole(body.chain_stats?.funded_txo_sum);
  const spent = whole(body.chain_stats?.spent_txo_sum);
  if (funded === null || spent === null || spent > funded) throw new BalanceError("unavailable");
  const confirmedTxs = whole(body.chain_stats?.tx_count);
  const waitingTxs = whole(body.mempool_stats?.tx_count);
  return { confirmed: funded - spent, used: confirmedTxs === null || waitingTxs === null ? null : confirmedTxs + waitingTxs > BigInt(0) };
}

const btc = (units: bigint): WalletAsset => ({ symbol: "BTC", name: "Bitcoin", units: units.toString(), decimals: 8 });

async function bitcoin(address: string, fetchImpl: typeof fetch): Promise<WalletAsset[]> {
  return [btc((await bitcoinAddress(address, fetchImpl)).confirmed)];
}

/** BIP 44's gap limit: a wallet is read until this many addresses in a row have never been used. */
export const GAP_LIMIT = 20;
/** The furthest address read on each side (receiving, change) of each script: a wallet past it is refused, not half-read. */
export const MAX_ADDRESS_INDEX = 500;
/** How many addresses are asked about at once: gentle on a free public service. */
const CONCURRENCY = 6;

export type WholeWalletReading = { assets: WalletAsset[]; used: number; scripts: Script[] };

/**
 * Everything a whole wallet holds: every address on both sides of each of
 * its scripts, read until GAP_LIMIT in a row are unused. With no scripts yet
 * (a bare xpub), the first receiving address of each kind is checked, and
 * the kinds that have been used are the wallet's; none used means an unused
 * wallet, $0, and the check again next time. All or nothing: if any address
 * can't be read, or `deadline` passes, there's no reading, never a part-total.
 */
export async function readWholeWallet(key: string, known: Script[], fetchImpl: typeof fetch = fetch, deadline?: AbortSignal): Promise<WholeWalletReading> {
  const at = walletAddresses(key);
  const seen = new Map<string, Promise<{ confirmed: bigint; used: boolean }>>();
  let running = 0;
  // Once one address fails the reading is lost, so nothing more is asked.
  let stopped = false;
  const queue: (() => void)[] = [];
  const ask = (address: string) => {
    let p = seen.get(address);
    if (!p) {
      p = new Promise<void>((go) => (running < CONCURRENCY ? (running++, go()) : queue.push(() => (running++, go()))))
        .then(() => {
          if (stopped || deadline?.aborted) throw new BalanceError("unavailable");
          return bitcoinAddress(address, fetchImpl, deadline);
        })
        // Where the gap limit falls depends on it: an answer that doesn't say is no answer.
        .then((r) => {
          if (r.used === null) throw new BalanceError("unavailable");
          return { confirmed: r.confirmed, used: r.used };
        })
        .catch((e: unknown) => {
          stopped = true;
          throw e;
        })
        .finally(() => {
          running--;
          queue.shift()?.();
        });
      seen.set(address, p);
    }
    return p;
  };

  let scripts = known;
  if (scripts.length === 0) {
    const first = await Promise.all(SCRIPTS.map((s) => ask(at(s, 0, 0))));
    scripts = SCRIPTS.filter((_, i) => first[i]!.used);
    if (scripts.length === 0) return { assets: [btc(BigInt(0))], used: 0, scripts: [] };
  }

  let total = BigInt(0);
  let used = 0;
  const side = async (script: Script, change: 0 | 1) => {
    let next = 0;
    let lastUsed = -1;
    while (next <= lastUsed + GAP_LIMIT) {
      const end = lastUsed + GAP_LIMIT;
      if (end > MAX_ADDRESS_INDEX) throw new BalanceError("too-large");
      const indexes = Array.from({ length: end - next + 1 }, (_, i) => next + i);
      const results = await Promise.all(indexes.map((i) => ask(at(script, change, i))));
      results.forEach((r, j) => {
        total += r.confirmed;
        if (r.used) {
          used++;
          lastUsed = Math.max(lastUsed, indexes[j]!);
        }
      });
      next = end + 1;
    }
  };
  await Promise.all(scripts.flatMap((s) => [side(s, 0), side(s, 1)]));
  if (deadline?.aborted) throw new BalanceError("unavailable");
  return { assets: [btc(total)], used, scripts };
}

/** Each call on its own, all at once: plain JSON-RPC, which every endpoint answers (not every one takes a batch). */
async function rpc(url: string, fetchImpl: typeof fetch, calls: { method: string; params: unknown[] }[]): Promise<unknown[]> {
  return Promise.all(
    calls.map(async (c, id) => {
      const r = (await getJson(fetchImpl, url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method: c.method, params: c.params }),
      })) as { result?: unknown; error?: unknown } | null;
      if (!r || r.error !== undefined || r.result === undefined || r.result === null) throw new BalanceError("unavailable");
      return r.result;
    }),
  );
}

async function ethereum(address: string, key: string, fetchImpl: typeof fetch): Promise<WalletAsset[]> {
  const [eth, tokens] = await rpc(`https://eth-mainnet.g.alchemy.com/v2/${encodeURIComponent(key)}`, fetchImpl, [
    { method: "eth_getBalance", params: [address, "latest"] },
    { method: "alchemy_getTokenBalances", params: [address, ETHEREUM_TOKENS.map((t) => t.contract)] },
  ]);
  const wei = whole(eth);
  if (wei === null) throw new BalanceError("unavailable");
  const out: WalletAsset[] = [{ symbol: "ETH", name: "Ether", units: wei.toString(), decimals: 18 }];
  for (const b of (tokens as { tokenBalances?: { contractAddress?: unknown; tokenBalance?: unknown }[] }).tokenBalances ?? []) {
    const token = ETHEREUM_TOKENS.find((t) => typeof b.contractAddress === "string" && t.contract === b.contractAddress.toLowerCase());
    const units = whole(b.tokenBalance);
    if (token && units !== null && units > BigInt(0)) out.push({ symbol: token.symbol, name: token.name, units: units.toString(), decimals: token.decimals });
  }
  return out;
}

async function solana(address: string, key: string, fetchImpl: typeof fetch): Promise<WalletAsset[]> {
  const [sol, ...tokens] = await rpc(`https://solana-mainnet.g.alchemy.com/v2/${encodeURIComponent(key)}`, fetchImpl, [
    { method: "getBalance", params: [address] },
    ...SOLANA_TOKENS.map((t) => ({ method: "getTokenAccountsByOwner", params: [address, { mint: t.mint }, { encoding: "jsonParsed" }] })),
  ]);
  const lamports = whole((sol as { value?: unknown }).value);
  if (lamports === null) throw new BalanceError("unavailable");
  const out: WalletAsset[] = [{ symbol: "SOL", name: "Solana", units: lamports.toString(), decimals: 9 }];
  SOLANA_TOKENS.forEach((t, i) => {
    let total = BigInt(0);
    for (const acct of (tokens[i] as { value?: { account?: { data?: { parsed?: { info?: { mint?: unknown; tokenAmount?: { amount?: unknown } } } } } }[] }).value ?? []) {
      const info = acct.account?.data?.parsed?.info;
      const units = whole(info?.tokenAmount?.amount);
      if (info?.mint === t.mint && units !== null) total += units;
    }
    if (total > BigInt(0)) out.push({ symbol: t.symbol, name: t.name, units: total.toString(), decimals: t.decimals });
  });
  return out;
}

/** What `address` holds on `chain`. Throws BalanceError when it can't be read. */
export async function readBalances(chain: Chain, address: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<WalletAsset[]> {
  if (chain === "bitcoin") return bitcoin(address, fetchImpl);
  const key = (env.ALCHEMY_API_KEY ?? "").trim();
  if (!key) throw new BalanceError("refused");
  return chain === "ethereum" ? ethereum(address, key, fetchImpl) : solana(address, key, fetchImpl);
}

/** Coinbase's public USD rates (units of each asset per dollar). No account, and nothing about the person, is sent. */
export async function usdRatesPublic(fetchImpl: typeof fetch = fetch): Promise<Record<string, number>> {
  const body = (await getJson(fetchImpl, "https://api.coinbase.com/v2/exchange-rates?currency=USD")) as { data?: { rates?: Record<string, unknown> } };
  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(body.data?.rates ?? {})) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) rates[code] = n;
  }
  return rates;
}
