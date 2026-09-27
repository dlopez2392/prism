// src/lib/server/finance.ts
//
// The one place a screen gets its data. Linked banks (a sealed vault cookie
// plus Plaid keys) → live data; otherwise the demo household. Wrapped in
// React's `cache`, so a layout and a page in the same request share one load.

import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { categoryTotals } from "@/lib/finance/cashflow";
import { SPEND_CATEGORIES } from "@/lib/finance/categories";
import { addDays, addMonths, startOfMonth } from "@/lib/finance/dates";
import { buildDemoData } from "@/lib/finance/demo";
import type { FinanceData, Holding, Institution, ISODate } from "@/lib/finance/types";
import {
  getAccounts,
  getHoldings,
  plaidConfig,
  PlaidError,
  syncAllTransactions,
  type PlaidConfig,
} from "@/lib/plaid/client";
import { mapAccount, mapHoldings, mapTransaction, suggestedLimit } from "@/lib/plaid/map";
import { open, VAULT_COOKIE, vaultKey, type VaultItem } from "./vault";

export type Loaded = FinanceData & {
  /** A problem worth a banner — the data shown is still real, just incomplete. */
  notice: string | null;
  plaidReady: boolean;
  /** The viewer's local hour, for "Good morning". */
  localHour: number;
};

export function hourIn(zone: string | undefined, now = new Date()): number {
  try {
    if (zone) return Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).format(now)) % 24;
  } catch {
    // Unknown zone: fall through.
  }
  return now.getUTCHours();
}

/** "Today" in the viewer's own calendar (the zone the browser reported), else UTC. */
export function todayIn(zone: string | undefined, now = new Date()): ISODate {
  try {
    if (zone) {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
      if (/^\d{4}-\d{2}-\d{2}$/.test(parts)) return parts;
    }
  } catch {
    // An unknown zone name falls through to UTC.
  }
  return now.toISOString().slice(0, 10);
}

export const getFinance = cache(async (): Promise<Loaded> => {
  const jar = await cookies();
  const zone = jar.get("prism-tz")?.value;
  const today = todayIn(zone);
  const localHour = hourIn(zone);
  const config = plaidConfig();
  let items: VaultItem[] = [];
  try {
    const key = vaultKey();
    items = key ? (open(jar.get(VAULT_COOKIE)?.value, key)?.items ?? []) : [];
  } catch {
    items = [];
  }
  if (!config || items.length === 0) {
    return { ...buildDemoData(today), notice: null, plaidReady: config !== null, localHour };
  }
  return { ...(await loadPlaid(config, items, today)), localHour };
});

async function loadPlaid(config: PlaidConfig, items: VaultItem[], today: ISODate): Promise<Omit<Loaded, "localHour">> {
  const institutions: Institution[] = [];
  const accounts: FinanceData["accounts"] = [];
  const transactions: FinanceData["transactions"] = [];
  const holdings: Holding[] = [];
  const problems: string[] = [];
  const now = new Date().toISOString();

  await Promise.all(
    items.map(async (item) => {
      const name = item.institutionName ?? "Your bank";
      try {
        const [acc, sync] = await Promise.all([getAccounts(config, item.accessToken), syncAllTransactions(config, item.accessToken)]);
        const txns = sync.transactions.map(mapTransaction);
        transactions.push(...txns);
        accounts.push(...acc.accounts.map((a) => mapAccount(a, item.itemId, txns, today)));
        institutions.push({ id: item.itemId, name, health: sync.ready ? "healthy" : "syncing", lastSyncedAt: now, source: "plaid" });
        if (acc.accounts.some((a) => a.type === "investment" || a.type === "brokerage")) {
          try {
            const h = await getHoldings(config, item.accessToken);
            holdings.push(...mapHoldings(h.holdings, h.securities));
          } catch {
            // Investments were an optional product; no consent is not an error.
          }
        }
      } catch (e) {
        const reauth = e instanceof PlaidError && (e.code === "ITEM_LOGIN_REQUIRED" || e.code === "PENDING_EXPIRATION");
        institutions.push({ id: item.itemId, name, health: "needs_attention", lastSyncedAt: null, source: "plaid" });
        problems.push(reauth ? `${name} needs you to sign in again.` : `We couldn't reach ${name} just now.`);
      }
    }),
  );

  transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // No budgets are stored yet for a live household, so draft them from the
  // last three FULL months — a starting point the person can see and adjust.
  const lastThree = categoryTotals(transactions, addMonths(startOfMonth(today), -3), addDays(startOfMonth(today), -1));
  const budgets = SPEND_CATEGORIES.filter((c) => lastThree[c] > 0).map((c) => ({ category: c, limit: suggestedLimit(lastThree[c]) }));

  return {
    source: "plaid",
    today,
    household: { name: "Your household", firstName: "there" },
    institutions,
    accounts,
    transactions,
    budgets,
    goals: [],
    holdings,
    credit: null,
    notice: problems.length ? problems.join(" ") : null,
    plaidReady: true,
  };
}
