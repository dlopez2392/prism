// src/lib/server/wallets.ts
//
// Reading the person's wallets again when their last reading is stale: every
// stale single-address wallet at once, priced in the same pass, and a wallet
// that can't be read (or no price) keeps its last reading. What's read is
// handed back for the caller to keep (account-store, saveWalletReadings) or,
// for a connected app, to use and forget.
//
// A whole Bitcoin wallet (an extended public key) takes dozens of requests,
// so no page waits for it: readWallets hands stale ones back as `later`, and
// refreshWholeWallets reads them after the response has gone, first claiming
// them (account-store, claimWalletScans) so only one request reads a wallet.

import "server-only";
import { BalanceError, chainEnabled, readBalances, readWholeWallet, usdRatesPublic } from "@/lib/crypto/balances";
import { isWholeWallet, priced, walletStale, type Reading, type Script, type Wallet } from "@/lib/crypto/wallets";
import type { Account } from "@/lib/supabase/server";
import { claimWalletScans, saveWalletReadings } from "./account-store";
import type { VaultKey } from "./vault";

type Env = Record<string, string | undefined>;

/** New readings by wallet id, each with the address (or key) it was read for, and a whole wallet's scripts as found. */
export type Fresh = Map<string, { address: string; reading: Reading; scripts?: Script[] }>;

/** How long a whole wallet may take to read: inside a serverless function's life after the page has gone. */
export const WHOLE_WALLET_DEADLINE_MS = 8_000;

export async function readWallets(
  wallets: Wallet[],
  { env = process.env, fetchImpl = fetch, now = Date.now() }: { env?: Env; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<{ wallets: Wallet[]; fresh: Fresh; later: Wallet[] }> {
  const stale = wallets.filter((w) => walletStale(w, now) && chainEnabled(w.chain, env));
  const later = stale.filter(isWholeWallet);
  const due = stale.filter((w) => !isWholeWallet(w));
  const fresh: Fresh = new Map();
  if (due.length === 0) return { wallets, fresh, later };
  const [rates, ...balances] = await Promise.allSettled([usdRatesPublic(fetchImpl), ...due.map((w) => readBalances(w.chain, w.address, env, fetchImpl))]);
  // Without prices a reading would say $0, which is worse than the last one.
  if (rates.status !== "fulfilled") return { wallets, fresh, later };
  const at = new Date(now).toISOString();
  // Whatever went wrong with one wallet, the page still draws: it keeps its last reading.
  due.forEach((w, i) => {
    const b = balances[i]!;
    if (b.status === "fulfilled") fresh.set(w.id, { address: w.address, reading: { at, assets: priced(b.value, rates.value) } });
  });
  return { wallets: wallets.map((w) => (fresh.has(w.id) ? { ...w, reading: fresh.get(w.id)!.reading } : w)), fresh, later };
}

/**
 * Whole wallets read in full, one after another (each already asks about
 * several addresses at once), all inside one deadline. A wallet that can't be
 * read in time has no new reading; `tooLarge` names any with more addresses
 * than Prism reads.
 */
export async function readWholeWallets(
  wallets: Wallet[],
  { fetchImpl = fetch, now = Date.now(), deadlineMs = WHOLE_WALLET_DEADLINE_MS }: { fetchImpl?: typeof fetch; now?: number; deadlineMs?: number } = {},
): Promise<{ fresh: Fresh; tooLarge: Set<string> }> {
  const fresh: Fresh = new Map();
  const tooLarge = new Set<string>();
  const whole = wallets.filter(isWholeWallet);
  if (whole.length === 0) return { fresh, tooLarge };
  const deadline = AbortSignal.timeout(deadlineMs);
  let rates: Record<string, number>;
  try {
    rates = await usdRatesPublic(fetchImpl);
  } catch {
    return { fresh, tooLarge };
  }
  const at = new Date(now).toISOString();
  for (const w of whole) {
    if (deadline.aborted) break;
    try {
      const r = await readWholeWallet(w.address, w.scripts ?? [], fetchImpl, deadline);
      fresh.set(w.id, { address: w.address, reading: { at, assets: priced(r.assets, rates), addresses: r.used }, scripts: r.scripts });
    } catch (e) {
      if (e instanceof BalanceError && e.reason === "too-large") tooLarge.add(w.id);
    }
  }
  return { fresh, tooLarge };
}

/** After the response: claim the stale whole wallets, read them, keep what was read. Nothing is thrown. */
export async function refreshWholeWallets(account: Account, wallets: Wallet[], key: VaultKey, opts: { fetchImpl?: typeof fetch; now?: number; deadlineMs?: number } = {}): Promise<void> {
  try {
    const claimed = new Set(await claimWalletScans(account, wallets.map((w) => w.id), key, opts.now));
    if (claimed.size === 0) return;
    const { fresh } = await readWholeWallets(wallets.filter((w) => claimed.has(w.id)), opts);
    if (fresh.size) await saveWalletReadings(account, fresh, key);
  } catch (e) {
    // No address, key or balance in the message: only that a reading wasn't kept.
    console.error("Prism: a wallet's reading wasn't kept:", e instanceof Error ? e.name : "unknown error");
  }
}
