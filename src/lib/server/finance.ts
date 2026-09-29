// src/lib/server/finance.ts
//
// The one place a screen gets its data. First: WHERE this person's money
// lives — their account when signed in, otherwise this device's sealed
// cookies. Then: anything real linked → live data; nothing → the demo
// household. Wrapped in React's `cache`, so a layout and a page in the same
// request share one load. `agentFinance` is the same money for a connected
// app (MCP), read-only: it never refreshes a token or writes a row.

import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { after } from "next/server";
import { categoryTotals } from "@/lib/finance/cashflow";
import { SPEND_CATEGORIES } from "@/lib/finance/categories";
import { addDays, addMonths, startOfMonth } from "@/lib/finance/dates";
import { buildDemoData } from "@/lib/finance/demo";
import type { AgentData } from "@/lib/agent/tools";
import { applyPlan, type Plan } from "@/lib/finance/plan";
import { feedSnapshot } from "@/lib/finance/calendar";
import type { FinanceData, Goal, Holding, Institution, ISODate } from "@/lib/finance/types";
import { getAccounts, getHoldings, plaidConfig, PlaidError, type PlaidAccount, type PlaidConfig, type PlaidTransaction } from "@/lib/plaid/client";
import { needsSync, syncTransactions, type StoredSync, type SyncState } from "@/lib/plaid/sync";
import { mapAccount, mapHoldings, mapTransaction, suggestedLimit } from "@/lib/plaid/map";
import { NO_RULES, recategorize, type CategoryRules } from "@/lib/finance/category-rules";
import { CoinbaseError, coinbaseConfig, listAccounts, usdRates, type CoinbaseConfig } from "@/lib/coinbase/client";
import { coinbaseNeedsSignIn, mapCoinbase } from "@/lib/coinbase/map";
import { COINBASE_COOKIE, isExpired, readLink } from "./coinbase-store";
import { currentAccount, type Account } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/config";
import { liveCoinbaseToken, loadAccount, saveAccountPlaidSync, saveAccountTimeZone, saveFeedSnapshot } from "./account-store";
import { CARRYOVER_COOKIE, readPlan } from "./plan-store";
import { open, VAULT_COOKIE, vaultKey, type VaultItem, type VaultKey } from "./vault";

export type Loaded = FinanceData & {
  /** A problem worth a banner — the data shown is still real, just incomplete. */
  notice: string | null;
  plaidReady: boolean;
  /** The viewer's local hour, for "Good morning". */
  localHour: number;
  /** Which lists the person has edited (vs. seeded or drafted). */
  planEdited: { budgets: boolean; goals: boolean };
  /** Accounts are switched on for this deployment. */
  accountsEnabled: boolean;
  /** The signed-in person, or null on a device-only visit. */
  account: { email: string | null; firstName: string | null; calendarFeed: boolean } | null;
  /** Signed in, with money or plans still sitting on this device from before: what they are. */
  carryover: string[];
};

export function hourIn(zone: string | undefined, now = new Date()): number {
  try {
    if (zone) return Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).format(now)) % 24;
  } catch {
    // Unknown zone: fall through.
  }
  return now.getUTCHours();
}

/** An IANA time zone name this runtime knows, or null — never free text. */
export function validZone(zone: string | null | undefined): string | null {
  if (!zone || zone.length > 64 || !/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(zone)) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
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

/** Where this request's money lives, before anything is fetched from a bank. */
export type Sources = {
  account: Account | null;
  firstName: string | null;
  plan: Plan;
  /** The person's category fixes, applied where their transactions are assembled. A device keeps none. */
  categories: CategoryRules;
  items: VaultItem[];
  /** A live Coinbase access token — or null for a dead link — fetched on demand. */
  coinbase: { config: CoinbaseConfig; token: () => Promise<string | null> } | null;
  feedUpdatedAt: string | null;
  /** The zone the account last saw the person in. */
  timeZone: string | null;
  /** Each bank's stored sync, and whether a new one may be saved (never for a connected app). Null on a device-only visit. */
  plaidSync: PlaidSync | null;
};

/** Where a bank's sync starts from, and where a newer one goes — `save` is null when nothing may be written. */
type PlaidSync = { stored: Map<string, StoredSync>; save: ((itemId: string, state: SyncState, fromVersion: number, startedAt: string) => void) | null };

type Money = Pick<Sources, "items" | "coinbase" | "plaidSync" | "categories">;

function safeVaultKey(): VaultKey | null {
  try {
    return vaultKey();
  } catch {
    return null;
  }
}

/**
 * Uncached on purpose: Server Actions read through this, so a save is never
 * checked against a copy of the data cached earlier in the same request.
 */
export async function readSources({ withSync = false }: { withSync?: boolean } = {}): Promise<Sources> {
  const jar = await cookies();
  const plaid = plaidConfig();
  const cb = coinbaseConfig();
  const key = safeVaultKey();
  const account = await currentAccount();

  if (account) {
    // Stored bank copies are loaded (and opened) only for what draws money — never for a plan edit.
    const a = await loadAccount(account, key, { withSync });
    // Seals an older vault key made move to the current one, after the response (vault.ts, "Keyring").
    if (a.reseal) after(a.reseal);
    const record = a.coinbase;
    return {
      account,
      firstName: a.firstName,
      plan: a.plan,
      categories: a.categories,
      items: plaid ? a.items : [],
      coinbase: cb && key && record ? { config: cb, token: () => liveCoinbaseToken(account, record, cb, key) } : null,
      feedUpdatedAt: a.feedUpdatedAt,
      timeZone: a.timeZone,
      plaidSync: {
        stored: a.plaidSync,
        // After the response: the page already has the new transactions; the saved copy is for next time.
        save: key
          ? (itemId, state, fromVersion, startedAt) =>
              after(() =>
                saveAccountPlaidSync(account, itemId, state, key, fromVersion, startedAt).catch((e: unknown) =>
                  // No bank data in the message — only that a copy wasn't kept (the next visit syncs again).
                  console.error("Prism: a bank's sync wasn't saved:", e instanceof Error ? e.message : "unknown error"),
                ),
              )
          : null,
      },
    };
  }

  // This device: the proxy keeps a Coinbase cookie fresh, so an expired one
  // here means its refresh failed.
  const link = cb && key ? readLink(jar.get(COINBASE_COOKIE)?.value, key) : null;
  return {
    account: null,
    firstName: null,
    plan: readPlan(jar),
    categories: NO_RULES,
    items: plaid ? vaultItems(jar) : [],
    coinbase: cb && link ? { config: cb, token: async () => (isExpired(link) ? null : link.accessToken) } : null,
    feedUpdatedAt: null,
    timeZone: null,
    // A device keeps no sync: its banks are read in full each time, as before accounts.
    plaidSync: null,
  };
}

const getSources = cache(() => readSources({ withSync: true }));

const isLive = (s: Money) => s.items.length > 0 || s.coinbase !== null;

/**
 * The goals the data source provides before any edit — the demo household's,
 * or none once anything real is linked. Cheap: never calls a bank.
 */
export async function sourceGoals(sources?: Sources): Promise<Goal[]> {
  const s = sources ?? (await readSources());
  return isLive(s) ? [] : buildDemoData(await requestToday()).goals;
}

/** Money or plans a signed-in person still has on this device from before they signed in. */
function carryoverOf(jar: Jar, signedIn: boolean): string[] {
  if (!signedIn || jar.get(CARRYOVER_COOKIE)?.value === "later") return [];
  const out: string[] = [];
  const banks = plaidConfig() ? vaultItems(jar).length : 0;
  if (banks) out.push(banks === 1 ? "a linked bank" : `${banks} linked banks`);
  if (coinbaseConfig() && safeVaultKey() && readLink(jar.get(COINBASE_COOKIE)?.value, safeVaultKey()!)) out.push("Coinbase");
  // Decoded, not merely present: a cookie deleted by an action in this same
  // request is still listed during the re-render, with an empty value.
  const plan = readPlan(jar);
  if (plan.budgets) out.push("your budgets");
  if (plan.goals) out.push("your goals");
  return out;
}

type Live = Omit<Loaded, "localHour" | "planEdited" | "accountsEnabled" | "account" | "carryover">;

/**
 * The money itself: the demo household when nothing real is linked (real and
 * made-up money are never shown together, so linking anything ends the
 * demo), else every bank and Coinbase, fetched in parallel.
 */
async function moneyFor(src: Money, today: ISODate, coinbaseLapsed?: string): Promise<Live> {
  const config = plaidConfig();
  if (!isLive(src)) return { ...buildDemoData(today), notice: null, plaidReady: config !== null };
  const [banks, crypto] = await Promise.all([
    config && src.items.length ? loadPlaid(config, src.items, today, src.plaidSync, src.categories) : Promise.resolve(emptyLive(today, config !== null)),
    src.coinbase ? src.coinbase.token().then((t) => loadCoinbase(src.coinbase!.config, t, coinbaseLapsed)) : Promise.resolve(null),
  ]);
  return crypto ? withCoinbase(banks, crypto) : banks;
}

/** The greeting belongs to whoever is signed in — even over the demo's example money, which is still Alex's household. */
function greeted(base: Live, firstName: string | null, live: boolean): Live {
  return { ...base, household: { name: firstName && live ? `${firstName}'s household` : base.household.name, firstName: firstName ?? "there" } };
}

export const getFinance = cache(async (): Promise<Loaded> => {
  const jar = await cookies();
  const zone = jar.get("prism-tz")?.value;
  const today = todayIn(zone);
  const localHour = hourIn(zone);
  const src = await getSources();
  const planEdited = { budgets: src.plan.budgets !== null, goals: src.plan.goals !== null };

  let base = await moneyFor(src, today);
  if (src.account) {
    if (isLive(src)) await refreshFeedIfStale(src.account, src.feedUpdatedAt, base);
    base = greeted(base, src.firstName, isLive(src));
    rememberZone(src.account, src.timeZone, zone);
  }
  // The person's own edits win over seeded or drafted budgets and goals.
  return {
    ...applyPlan(base, src.plan),
    localHour,
    planEdited,
    accountsEnabled: supabaseEnv() !== null,
    account: src.account ? { email: src.account.email, firstName: src.firstName, calendarFeed: src.feedUpdatedAt !== null } : null,
    carryover: carryoverOf(jar, src.account !== null),
  };
});

/**
 * Keep the account's time zone current, so a connected app's "this month" is
 * the person's month. After the response, and only when it moved.
 */
function rememberZone(account: Account, stored: string | null, seen: string | undefined): void {
  const zone = validZone(seen);
  if (!zone || zone === stored) return;
  after(() => saveAccountTimeZone(account, zone).catch(() => undefined));
}


/**
 * The account's money for a connected app (MCP). Read-only through and
 * through: the database refuses a connected app's writes anyway, and this
 * never tries one — a Coinbase access token that has lapsed is NOT refreshed
 * (its refresh token works once, and the new pair could not be saved), so
 * crypto waits until the person next opens Prism.
 */
export async function agentFinance(account: Account): Promise<AgentData> {
  const plaid = plaidConfig();
  const cb = coinbaseConfig();
  const key = safeVaultKey();
  const a = await loadAccount(account, key, { strict: true, withSync: true });
  const timeZone = validZone(a.timeZone) ?? "UTC";
  const today = todayIn(timeZone);
  const record = a.coinbase;
  const src: Money = {
    items: plaid ? a.items : [],
    // Catch up from the stored cursor in memory; a connected app never saves (and the database wouldn't let it).
    plaidSync: { stored: a.plaidSync, save: null },
    categories: a.categories,
    coinbase: cb && key && record ? { config: cb, token: async () => (isExpired(record.tokens, Date.now() + 60_000) ? null : record.tokens.accessToken) } : null,
  };
  const base = greeted(await moneyFor(src, today, "Coinbase balances update the next time you open Prism."), a.firstName, isLive(src));
  const planned = applyPlan(base, a.plan);
  return {
    source: planned.source,
    today: planned.today,
    household: planned.household,
    institutions: planned.institutions,
    accounts: planned.accounts,
    transactions: planned.transactions,
    budgets: planned.budgets,
    goals: planned.goals,
    holdings: planned.holdings,
    credit: planned.credit,
    notice: planned.notice,
    demo: !isLive(src),
    timeZone,
    budgetsSetByPerson: a.plan.budgets !== null,
  };
}

const FEED_STALE_MS = 6 * 60 * 60_000;

async function refreshFeedIfStale(account: Account, updatedAt: string | null, data: Live): Promise<void> {
  if (!updatedAt || Date.now() - Date.parse(updatedAt) < FEED_STALE_MS) return;
  // No key, no refresh: a snapshot is only ever stored sealed.
  const key = safeVaultKey();
  if (!key) return;
  try {
    await saveFeedSnapshot(account, feedSnapshot(data), key);
  } catch {
    // A stale calendar is better than a broken page.
  }
}

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

async function loadCoinbase(config: CoinbaseConfig, accessToken: string | null, lapsed = "Coinbase needs you to sign in again."): Promise<CoinbaseLoad> {
  // No live token: in the app the refresh failed and only a fresh sign-in
  // fixes it; for a connected app the token simply waits for the next visit.
  if (!accessToken) return { institution: coinbaseNeedsSignIn(), account: null, holdings: [], problem: lapsed };
  try {
    const [wallets, rates] = await Promise.all([listAccounts(config, accessToken), usdRates(config)]);
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

const isReauth = (e: unknown) => e instanceof PlaidError && (e.code === "ITEM_LOGIN_REQUIRED" || e.code === "PENDING_EXPIRATION");

/**
 * A bank as of now: the stored copy — balances and transactions — while it's
 * fresh and Plaid has been quiet (no Plaid call at all); else the balances
 * plus only what changed since its cursor, or the whole history the first
 * time. If Plaid can't be reached, the last copy still stands (and the page
 * says so), unless the bank needs the person to sign in again.
 */
async function bankFor(
  config: PlaidConfig,
  item: VaultItem,
  sync: PlaidSync | null,
  today: ISODate,
): Promise<{ accounts: PlaidAccount[]; transactions: PlaidTransaction[]; ready: boolean; syncedAt: string; fromCopy: boolean }> {
  const stored = sync?.stored.get(item.itemId) ?? null;
  const copy = stored?.state ?? null;
  if (copy?.accounts && !needsSync(stored)) return { accounts: copy.accounts, transactions: copy.transactions, ready: copy.ready, syncedAt: stored!.syncedAt!, fromCopy: false };
  const startedAt = new Date().toISOString();
  let next: SyncState;
  try {
    const [acc, synced] = await Promise.all([getAccounts(config, item.accessToken), syncTransactions(config, item.accessToken, copy, { today })]);
    next = { ...synced, accounts: acc.accounts };
  } catch (e) {
    if (copy?.accounts && stored?.syncedAt && !isReauth(e)) return { accounts: copy.accounts, transactions: copy.transactions, ready: copy.ready, syncedAt: stored.syncedAt, fromCopy: true };
    throw e;
  }
  // Outside the try: a problem keeping the copy is never mistaken for Plaid being down.
  sync?.save?.(item.itemId, next, stored?.version ?? 0, startedAt);
  return { accounts: next.accounts ?? [], transactions: next.transactions, ready: next.ready, syncedAt: startedAt, fromCopy: false };
}

async function loadPlaid(config: PlaidConfig, items: VaultItem[], today: ISODate, sync: PlaidSync | null = null, rules: CategoryRules = NO_RULES): Promise<Live> {
  const institutions: Institution[] = [];
  const accounts: FinanceData["accounts"] = [];
  const transactions: FinanceData["transactions"] = [];
  const holdings: Holding[] = [];
  const problems: string[] = [];

  await Promise.all(
    items.map(async (item) => {
      const name = item.institutionName ?? "Your bank";
      try {
        const bank = await bankFor(config, item, sync, today);
        const txns = bank.transactions.map(mapTransaction);
        transactions.push(...txns);
        accounts.push(...bank.accounts.map((a) => mapAccount(a, item.itemId, txns, today)));
        institutions.push({ id: item.itemId, name, health: bank.ready ? "healthy" : "syncing", lastSyncedAt: bank.syncedAt, source: "plaid" });
        if (bank.fromCopy) problems.push(`${name} couldn't be updated just now — showing it as of the last sync.`);
        if (bank.accounts.some((a) => a.type === "investment" || a.type === "brokerage")) {
          try {
            const h = await getHoldings(config, item.accessToken);
            holdings.push(...mapHoldings(h.holdings, h.securities));
          } catch {
            // Investments were an optional product; no consent is not an error.
          }
        }
      } catch (e) {
        const reauth = isReauth(e);
        institutions.push({ id: item.itemId, name, health: "needs_attention", lastSyncedAt: null, source: "plaid" });
        problems.push(reauth ? `${name} needs you to sign in again.` : `We couldn't reach ${name} just now.`);
      }
    }),
  );

  transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // The person's own category fixes come first, so everything after — the
  // drafted budgets, every chart, insight and connected-app answer — agrees.
  const fixed = recategorize(transactions, rules);
  // No budgets are stored yet for a live household, so draft them from the
  // last three FULL months — a starting point the person can see and adjust.
  const lastThree = categoryTotals(fixed, addMonths(startOfMonth(today), -3), addDays(startOfMonth(today), -1));
  const budgets = SPEND_CATEGORIES.filter((c) => lastThree[c] > 0).map((c) => ({ category: c, limit: suggestedLimit(lastThree[c]) }));

  return {
    source: "plaid",
    today,
    household: { name: "Your household", firstName: "there" },
    institutions,
    accounts,
    transactions: fixed,
    budgets,
    goals: [],
    holdings,
    credit: null,
    notice: problems.length ? problems.join(" ") : null,
    plaidReady: true,
  };
}
