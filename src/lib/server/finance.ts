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
import { applyPlan } from "@/lib/finance/plan";
import type { FinanceData, Goal, Holding, Institution, ISODate } from "@/lib/finance/types";
import {
  getAccounts,
  getHoldings,
  plaidConfig,
  PlaidError,
  syncAllTransactions,
  type PlaidConfig,
} from "@/lib/plaid/client";
import { mapAccount, mapHoldings, mapTransaction, suggestedLimit } from "@/lib/plaid/map";
import { CoinbaseError, coinbaseConfig, listAccounts, usdRates, type CoinbaseConfig } from "@/lib/coinbase/client";
import { coinbaseNeedsSignIn, mapCoinbase } from "@/lib/coinbase/map";
import { COINBASE_COOKIE, isExpired, readLink, type CoinbaseLink } from "./coinbase-store";
import { readPlan } from "./plan-store";
import { open, VAULT_COOKIE, vaultKey, type VaultItem } from "./vault";

export type Loaded = FinanceData & {
  /** A problem worth a banner — the data shown is still real, just incomplete. */
  notice: string | null;
  plaidReady: boolean;
  /** The viewer's local hour, for "Good morning". */
  localHour: number;
  /** Which lists the person has edited on this device (vs. seeded or drafted). */
  planEdited: { budgets: boolean; goals: boolean };
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

/** The linked banks in this browser's vault — empty when there are none or no key. */
function vaultItems(jar: Jar): VaultItem[] {
  try {
    const key = vaultKey();
    return key ? (open(jar.get(VAULT_COOKIE)?.value, key)?.items ?? []) : [];
  } catch {
    return [];
  }
}

type Jar = Awaited<ReturnType<typeof cookies>>;

/** "Today" for this request, in the viewer's calendar. */
export async function requestToday(): Promise<ISODate> {
  return todayIn((await cookies()).get("prism-tz")?.value);
}

/**
 * The goals the data source provides before any edit on this device — the
 * demo household's, or none for a live bank. Cheap: never calls the bank.
 */
export async function sourceGoals(): Promise<Goal[]> {
  const jar = await cookies();
  const live = (plaidConfig() !== null && vaultItems(jar).length > 0) || coinbaseLinkOf(jar) !== null;
  return live ? [] : buildDemoData(todayIn(jar.get("prism-tz")?.value)).goals;
}

/** This browser's Coinbase link, when this deployment has Coinbase keys and a vault key to open it. */
function coinbaseLinkOf(jar: Jar): { config: CoinbaseConfig; link: CoinbaseLink } | null {
  const config = coinbaseConfig();
  if (!config) return null;
  try {
    const key = vaultKey();
    const link = key ? readLink(jar.get(COINBASE_COOKIE)?.value, key) : null;
    return link ? { config, link } : null;
  } catch {
    return null;
  }
}

type Live = Omit<Loaded, "localHour" | "planEdited">;

export const getFinance = cache(async (): Promise<Loaded> => {
  const jar = await cookies();
  const zone = jar.get("prism-tz")?.value;
  const today = todayIn(zone);
  const localHour = hourIn(zone);
  const config = plaidConfig();
  const items = config ? vaultItems(jar) : [];
  const coinbase = coinbaseLinkOf(jar);
  const plan = readPlan(jar);
  const planEdited = { budgets: plan.budgets !== null, goals: plan.goals !== null };

  let base: Live;
  if (items.length === 0 && !coinbase) {
    // Nothing real is linked: the demo household. Real and made-up money are
    // never shown together, so linking anything at all ends the demo.
    base = { ...buildDemoData(today), notice: null, plaidReady: config !== null };
  } else {
    const [banks, crypto] = await Promise.all([
      config && items.length ? loadPlaid(config, items, today) : Promise.resolve(emptyLive(today, config !== null)),
      coinbase ? loadCoinbase(coinbase.config, coinbase.link) : Promise.resolve(null),
    ]);
    base = crypto ? withCoinbase(banks, crypto) : banks;
  }
  // The person's own edits win over seeded or drafted budgets and goals.
  return { ...applyPlan(base, plan), localHour, planEdited };
});

function emptyLive(today: ISODate, plaidReady: boolean): Live {
  return {
    source: "coinbase",
    today,
    household: { name: "Your household", firstName: "there" },
    institutions: [],
    accounts: [],
    transactions: [],
    budgets: [],
    goals: [],
    holdings: [],
    credit: null,
    notice: null,
    plaidReady,
  };
}

type CoinbaseLoad = { institution: Institution; account: FinanceData["accounts"][number] | null; holdings: Holding[]; problem: string | null };

async function loadCoinbase(config: CoinbaseConfig, link: CoinbaseLink): Promise<CoinbaseLoad> {
  // The proxy refreshes a token before it lapses; reaching here expired means
  // that refresh failed, and only a fresh sign-in will fix it.
  if (isExpired(link)) return { institution: coinbaseNeedsSignIn(), account: null, holdings: [], problem: "Coinbase needs you to sign in again." };
  try {
    const [wallets, rates] = await Promise.all([listAccounts(config, link.accessToken), usdRates(config)]);
    const snap = mapCoinbase(wallets, rates, new Date().toISOString());
    // A coin Coinbase can't price is left out of the total; that is not a
    // problem the person can fix, so it never raises the "Fix it" banner.
    return { institution: snap.institution, account: snap.account, holdings: snap.holdings, problem: null };
  } catch (e) {
    const reauth = e instanceof CoinbaseError && e.needsReconnect;
    return {
      institution: coinbaseNeedsSignIn(),
      account: null,
      holdings: [],
      problem: reauth ? "Coinbase needs you to sign in again." : "We couldn't reach Coinbase just now.",
    };
  }
}

function withCoinbase(base: Live, cb: CoinbaseLoad): Live {
  const notice = [base.notice, cb.problem].filter(Boolean).join(" ") || null;
  return {
    ...base,
    institutions: [...base.institutions, cb.institution],
    accounts: cb.account ? [...base.accounts, cb.account] : base.accounts,
    holdings: [...base.holdings, ...cb.holdings],
    notice,
  };
}

async function loadPlaid(config: PlaidConfig, items: VaultItem[], today: ISODate): Promise<Live> {
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
