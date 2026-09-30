// src/lib/crypto/wallets.ts
//
// Self-custody crypto wallets, added by public address: Prism can see what an
// address holds and can never move it — there is nothing to sign and no key to
// give. Each wallet keeps its last reading (what it held, and what that was
// worth in dollars) so a page never waits on a slow service, and is read
// again once that reading is FRESH_MS old.
//
// A Bitcoin wallet can also be added whole, by its extended public key
// (xpub.ts): every address in it, kept as one canonical xpub with the kinds
// of address it pays to. Reading one means asking about dozens of addresses,
// so it is read after the page is sent, at most every WHOLE_FRESH_MS, and
// `tried` marks the attempt so two pages never read the same wallet at once.
//
// An address is private: anyone who ties it to a person sees everything it has
// ever held, and an extended public key shows every address in the wallet. So wallets are sealed in the person's own account
// (profiles.sealed_wallets) and never shared with a household.
//
// Pure: the balance services are in balances.ts, the checksums in address.ts.

import type { Account, Cents, Holding, Institution } from "@/lib/finance/types";

export type Chain = "bitcoin" | "ethereum" | "solana";

export const CHAINS: Record<Chain, { label: string; symbol: string; placeholder: string; readBy: string }> = {
  bitcoin: { label: "Bitcoin", symbol: "BTC", placeholder: "bc1q… or 1… or 3…", readBy: "mempool.space" },
  ethereum: { label: "Ethereum", symbol: "ETH", placeholder: "0x…", readBy: "Alchemy" },
  solana: { label: "Solana", symbol: "SOL", placeholder: "A Solana address", readBy: "Alchemy" },
};

/** The kinds of single-key Bitcoin address, most common first: the order a bare xpub's history is checked in. */
export type Script = "p2pkh" | "p2sh-p2wpkh" | "p2wpkh" | "p2tr";
export const SCRIPTS: Script[] = ["p2wpkh", "p2tr", "p2sh-p2wpkh", "p2pkh"];

export function isScript(x: unknown): x is Script {
  return typeof x === "string" && (SCRIPTS as string[]).includes(x);
}

export function isChain(x: unknown): x is Chain {
  return typeof x === "string" && Object.hasOwn(CHAINS, x);
}

/** An amount of one asset, exactly: `units` of its smallest part (satoshis, wei, lamports), and how many decimals make one. */
export type WalletAsset = { symbol: string; name: string; units: string; decimals: number };

export type Reading = {
  /** When it was read (ISO time). */
  at: string;
  /** What the address held, each with its dollar value then (null when there was no price for it). */
  assets: (WalletAsset & { usd: Cents | null })[];
  /** For a whole wallet: how many of its addresses have ever been used. */
  addresses?: number;
};

export type Wallet = {
  /** A short random id, never derived from the address. */
  id: string;
  chain: Chain;
  /** The public address, or for a whole Bitcoin wallet its canonical extended public key ("xpub…"). */
  address: string;
  name: string;
  reading: Reading | null;
  /** A whole wallet's kinds of address; empty until its history shows which (a bare xpub). */
  scripts?: Script[];
  /** When a whole wallet was last set to be read (ISO time): no second read starts before it's due again. */
  tried?: string;
};

export const MAX_WALLETS = 10;
export const WALLET_NAME_MAX = 40;
/** How old a reading may be before the next visit reads the address again. */
export const FRESH_MS = 15 * 60_000;
/** The same for a whole wallet, which takes dozens of requests to read. */
export const WHOLE_FRESH_MS = 30 * 60_000;
export const WALLETS_INSTITUTION_ID = "wallets";

const ID = /^[a-z0-9]{8,16}$/;
const ADDRESS: Record<Chain, RegExp> = {
  bitcoin: /^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34}|xpub[1-9A-HJ-NP-Za-km-z]{107})$/,
  ethereum: /^0x[0-9a-f]{40}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
};

/** A Bitcoin wallet added whole, by its extended public key. */
export function isWholeWallet(w: Pick<Wallet, "chain" | "address">): boolean {
  return w.chain === "bitcoin" && w.address.startsWith("xpub");
}

/** A name as a person would type it: trimmed, spaces collapsed, no control characters. */
export function cleanWalletName(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const s = x.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s.length > 0 && s.length <= WALLET_NAME_MAX ? s : null;
}

function validReading(x: unknown): Reading | null {
  const r = x as Partial<Reading> | null;
  if (!r || typeof r.at !== "string" || !Number.isFinite(Date.parse(r.at)) || !Array.isArray(r.assets) || r.assets.length > 20) return null;
  const assets: Reading["assets"] = [];
  for (const a of r.assets) {
    const ok =
      a &&
      typeof a.symbol === "string" &&
      /^[A-Z0-9]{1,10}$/.test(a.symbol) &&
      typeof a.name === "string" &&
      a.name.length <= 40 &&
      typeof a.units === "string" &&
      /^\d{1,40}$/.test(a.units) &&
      Number.isInteger(a.decimals) &&
      a.decimals >= 0 &&
      a.decimals <= 30 &&
      (a.usd === null || (Number.isSafeInteger(a.usd) && a.usd >= 0));
    if (!ok) return null;
    assets.push({ symbol: a.symbol, name: a.name, units: a.units, decimals: a.decimals, usd: a.usd });
  }
  const addresses = r.addresses;
  if (addresses !== undefined && !(Number.isSafeInteger(addresses) && addresses >= 0 && addresses <= 10_000)) return null;
  return addresses === undefined ? { at: r.at, assets } : { at: r.at, assets, addresses };
}

/** What's stored, as wallets: each valid one survives on its own; never two with one id, or one address twice. */
export function validWallets(x: unknown): Wallet[] {
  const list = (x as { v?: unknown; wallets?: unknown } | null)?.v === 1 ? (x as { wallets?: unknown }).wallets : null;
  if (!Array.isArray(list)) return [];
  const out: Wallet[] = [];
  const seen = new Set<string>();
  for (const raw of list.slice(0, MAX_WALLETS)) {
    const w = raw as Partial<Wallet> | null;
    if (!w || !isChain(w.chain) || typeof w.id !== "string" || !ID.test(w.id) || typeof w.address !== "string" || !ADDRESS[w.chain].test(w.address)) continue;
    const name = cleanWalletName(w.name);
    if (!name || seen.has(w.id) || seen.has(`${w.chain}:${w.address}`)) continue;
    seen.add(w.id);
    seen.add(`${w.chain}:${w.address}`);
    const wallet: Wallet = { id: w.id, chain: w.chain, address: w.address, name, reading: validReading(w.reading) };
    if (isWholeWallet(wallet)) {
      const scripts = Array.isArray(w.scripts) ? w.scripts.filter(isScript) : [];
      wallet.scripts = [...new Set(scripts)];
      if (typeof w.tried === "string" && Number.isFinite(Date.parse(w.tried))) wallet.tried = w.tried;
    }
    out.push(wallet);
  }
  return out;
}

export function storedWallets(wallets: Wallet[]) {
  return { v: 1 as const, wallets };
}

export function walletStale(w: Wallet, now = Date.now()): boolean {
  const last = Math.max(w.reading ? Date.parse(w.reading.at) : -Infinity, w.tried ? Date.parse(w.tried) : -Infinity);
  return now - last > (isWholeWallet(w) ? WHOLE_FRESH_MS : FRESH_MS);
}

/** A whole number of smallest units as a decimal amount. Exact enough to price; the units stay exact. */
export function amountOf(a: Pick<WalletAsset, "units" | "decimals">): number {
  const units = a.units.replace(/^0+(?=\d)/, "");
  if (a.decimals === 0) return Number(units);
  const padded = units.padStart(a.decimals + 1, "0");
  return Number(`${padded.slice(0, -a.decimals)}.${padded.slice(-a.decimals)}`);
}

/** Dollars for each asset at Coinbase's USD rates (units of the asset per dollar); null where there's no rate. */
export function priced(assets: WalletAsset[], rates: Record<string, number>): Reading["assets"] {
  return assets.map((a) => {
    const rate = rates[a.symbol];
    return { ...a, usd: rate ? Math.round((amountOf(a) / rate) * 100) : null };
  });
}

/** The wallet as one of Prism's accounts, with a holding for each asset worth a cent. A wallet never read yet shows $0. */
export function walletMoney(w: Wallet): { account: Account; holdings: Holding[] } {
  const accountId = `wallet-${w.id}`;
  const holdings: Holding[] = (w.reading?.assets ?? [])
    .filter((a) => (a.usd ?? 0) > 0)
    .map((a) => ({ symbol: a.symbol, name: a.name, assetClass: "Crypto" as const, value: a.usd!, costBasis: a.usd!, accountId }))
    .sort((a, b) => b.value - a.value);
  const balance = holdings.reduce((s, h) => s + h.value, 0);
  return {
    // One honest point: Prism knows today's value, not last year's.
    account: { id: accountId, institutionId: WALLETS_INSTITUTION_ID, name: w.name, mask: w.address.slice(-4), kind: "crypto", balance, history: [balance], source: "wallet" },
    holdings,
  };
}

/** "Your wallets", as of the oldest reading, and needing attention while any wallet couldn't be read. */
export function walletsInstitution(wallets: Wallet[]): Institution {
  const times = wallets.map((w) => w.reading?.at ?? null);
  const unread = times.some((t) => t === null);
  const oldest = times.filter((t): t is string => t !== null).sort()[0] ?? null;
  return { id: WALLETS_INSTITUTION_ID, name: "Your wallets", health: unread ? "needs_attention" : "healthy", lastSyncedAt: oldest, source: "wallet" };
}

/** "0.0512 BTC": the amount, to a sensible number of places for its asset. */
export function assetAmountText(a: Pick<WalletAsset, "symbol" | "units" | "decimals">): string {
  const places = Math.min(a.decimals, a.symbol === "USDC" || a.symbol === "USDT" || a.symbol === "DAI" ? 2 : 8);
  return `${amountOf(a).toLocaleString("en-US", { maximumFractionDigits: places })} ${a.symbol}`;
}

/** How long ago a reading was taken: "just now", "12 minutes ago", "3 hours ago", "2 days ago". */
export function readAgo(at: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
