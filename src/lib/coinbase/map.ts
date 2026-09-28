// src/lib/coinbase/map.ts
//
// Coinbase wallets → Prism's model: ONE account ("Coinbase", kind crypto)
// whose balance is everything held there in dollars, and one holding per
// currency for the Net worth treemap. Coinbase keeps a wallet per currency
// (and sometimes a vault beside it); they are summed by currency, empty ones
// are dropped, and anything Coinbase cannot price in dollars is left out of
// the total rather than guessed at.

import type { Account, Cents, Holding, Institution } from "@/lib/finance/types";
import type { CoinbaseAccount } from "./client";

export const COINBASE_ID = "coinbase";

export type CoinbaseSnapshot = {
  institution: Institution;
  account: Account;
  holdings: Holding[];
  /** Currencies held that have no dollar price, so aren't counted. */
  unpriced: string[];
};

/** Dollar value in cents of `amount` units, given units-per-dollar `rate`. */
export function toUsdCents(amount: number, rate: number): Cents {
  return Math.round((amount / rate) * 100);
}

export function mapCoinbase(wallets: CoinbaseAccount[], rates: Record<string, number>, syncedAt: string): CoinbaseSnapshot {
  const byCode = new Map<string, { name: string; fiat: boolean; amount: number }>();
  for (const w of wallets) {
    const code = w.currency?.code ?? w.balance?.currency;
    const amount = Number(w.balance?.amount);
    if (!code || !Number.isFinite(amount) || amount <= 0) continue;
    const prev = byCode.get(code);
    byCode.set(code, {
      name: w.currency?.name || code,
      fiat: w.type === "fiat" || w.currency?.type === "fiat",
      amount: (prev?.amount ?? 0) + amount,
    });
  }

  const holdings: Holding[] = [];
  const unpriced: string[] = [];
  for (const [code, h] of byCode) {
    const rate = rates[code];
    if (!rate) {
      unpriced.push(code);
      continue;
    }
    const value = toUsdCents(h.amount, rate);
    if (value <= 0) continue; // dust worth less than half a cent
    // Coinbase doesn't report what was paid, and nothing on screen shows a
    // gain, so cost basis mirrors value exactly as the Plaid mapping does.
    holdings.push({ symbol: code, name: h.name, assetClass: h.fiat ? "Cash" : "Crypto", value, costBasis: value, accountId: COINBASE_ID });
  }
  holdings.sort((a, b) => b.value - a.value);

  const balance = holdings.reduce((s, h) => s + h.value, 0);
  return {
    institution: { id: COINBASE_ID, name: "Coinbase", health: "healthy", lastSyncedAt: syncedAt, source: "coinbase" },
    // One honest point: Prism knows today's value, not last year's.
    account: { id: COINBASE_ID, institutionId: COINBASE_ID, name: "Coinbase", mask: null, kind: "crypto", balance, history: [balance], source: "coinbase" },
    holdings,
    unpriced: unpriced.sort(),
  };
}

/** What a broken or expired link still shows: the institution, marked for a fresh sign-in. */
export function coinbaseNeedsSignIn(): Institution {
  return { id: COINBASE_ID, name: "Coinbase", health: "needs_attention", lastSyncedAt: null, source: "coinbase" };
}
