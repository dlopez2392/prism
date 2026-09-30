// src/lib/server/wallets.ts
//
// Reading the person's wallets again when their last reading is FRESH_MS old:
// every stale wallet at once, priced in the same pass, and a wallet that
// can't be read (or no price) keeps its last reading. What's read is handed
// back for the caller to keep (account-store, saveWalletReadings) or, for a
// connected app, to use and forget.

import "server-only";
import { chainEnabled, readBalances, usdRatesPublic } from "@/lib/crypto/balances";
import { priced, walletStale, type Reading, type Wallet } from "@/lib/crypto/wallets";

type Env = Record<string, string | undefined>;

export type Fresh = Map<string, { address: string; reading: Reading }>;

export async function readWallets(
  wallets: Wallet[],
  { env = process.env, fetchImpl = fetch, now = Date.now() }: { env?: Env; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<{ wallets: Wallet[]; fresh: Fresh }> {
  const due = wallets.filter((w) => walletStale(w, now) && chainEnabled(w.chain, env));
  const fresh: Fresh = new Map();
  if (due.length === 0) return { wallets, fresh };
  const [rates, ...balances] = await Promise.allSettled([usdRatesPublic(fetchImpl), ...due.map((w) => readBalances(w.chain, w.address, env, fetchImpl))]);
  // Without prices a reading would say $0, which is worse than the last one.
  if (rates.status !== "fulfilled") return { wallets, fresh };
  const at = new Date(now).toISOString();
  // Whatever went wrong with one wallet, the page still draws: it keeps its last reading.
  due.forEach((w, i) => {
    const b = balances[i]!;
    if (b.status === "fulfilled") fresh.set(w.id, { address: w.address, reading: { at, assets: priced(b.value, rates.value) } });
  });
  return { wallets: wallets.map((w) => (fresh.has(w.id) ? { ...w, reading: fresh.get(w.id)!.reading } : w)), fresh };
}
