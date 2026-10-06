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
import { draftBudgets } from "@/lib/finance/budgets";
import { buildDemoData } from "@/lib/finance/demo";
import type { AgentData } from "@/lib/agent/tools";
import { applyPlan, followAccounts, toGoal, type Plan } from "@/lib/finance/plan";
import { feedSnapshot } from "@/lib/finance/calendar";
import type { Cents, FinanceData, Goal, Holding, Institution, ISODate, Transaction } from "@/lib/finance/types";
import { importAccountId, summarize, type ImportedHistory, type ImportSummary, type LockedImport } from "@/lib/finance/import";
import { getAccounts, getHoldings, plaidConfig, PlaidError, type PlaidAccount, type PlaidConfig, type PlaidTransaction } from "@/lib/plaid/client";
import { holdingsOnly, needsSync, syncTransactions, validState, type StoredSync, type SyncState } from "@/lib/plaid/sync";
import { mapAccount, mapHoldings, mapTransaction } from "@/lib/plaid/map";
import { getLiabilities, holdsDebt, liabilitiesEnabled, liabilitiesStale, toLiability, type StoredLiability } from "@/lib/plaid/liabilities";
import { NO_RULES, recategorize, validCategoryRules, type CategoryRules } from "@/lib/finance/category-rules";
import { manualAccount, manualInstitution, validManualItems, type ManualItem } from "@/lib/finance/manual";
import { applyDetails, hideAccounts, NO_DETAILS, type SplitRule, type TxnDetails } from "@/lib/finance/details";
import { applyOrderNotes, NO_ORDER_NOTES, type OrderNotes } from "@/lib/finance/orders";
import { applyP2pNotes, NO_P2P_NOTES, type P2pNotes } from "@/lib/finance/p2p";
import { valuationDue, type HomeValuation } from "@/lib/finance/home-value";
import { monthKey } from "@/lib/finance/dates";
import { homeValuesEnabled } from "@/lib/homevalue/rentcast";
import { pausedBeyondFree } from "@/lib/billing/plans";
import { plusFor } from "@/lib/billing/plus";
import { walletMoney, walletsInstitution, type Wallet } from "@/lib/crypto/wallets";
import { readWallets, refreshWholeWallets, type Fresh } from "./wallets";
import { refreshDueHomeValues } from "./home-values";
import { householdData, narrowTo, type MemberMoney } from "@/lib/finance/household";
import { CoinbaseError, coinbaseConfig, listAccounts, usdRates, type CoinbaseConfig } from "@/lib/coinbase/client";
import { coinbaseNeedsSignIn, mapCoinbase, sharedCoinbase, validCoinbaseValue } from "@/lib/coinbase/map";
import { COINBASE_COOKIE, isExpired, readLink } from "./coinbase-store";
import { currentAccount, type Account } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/config";
import {
  clearBankAttention,
  forgetAlertSnapshot,
  liveCoinbaseToken,
  loadAccount,
  saveAccountPlaidSync,
  saveAccountLanguage,
  saveAccountTimeZone,
  saveAlertSnapshot,
  saveCoinbaseValue,
  saveFeedSnapshot,
  saveWalletReadings,
  type AccountSources,
  type AlertSettings,
} from "./account-store";
import { alertSnapshot } from "@/lib/finance/alert-snapshot";
import { analyze } from "@/lib/finance/model";
import { CARRYOVER_COOKIE, readPlan } from "./plan-store";
import { loadHouseholdPlan, loadShares, loadSharedMoney, type HouseholdPlan, type SharedMoneyRow } from "./household-store";
import { open, openPacked, VAULT_COOKIE, vaultKey, type VaultItem, type VaultKey } from "./vault";
import type { Locale } from "@/lib/i18n/locale";
import { getT } from "@/lib/i18n/server";
import { msg, type T } from "@/lib/i18n/t";

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
  account: { email: string | null; firstName: string | null; calendarFeed: boolean; alerts: AlertSettings | null } | null;
  /** Signed in, with money or plans still sitting on this device from before: what they are. */
  /** What's still on this device from before signing in, each a sentence to translate (with its count). */
  carryover: Carryover[];
  /** What the signed-in person added by hand, as they entered it, for the editor on Net worth. */
  manual: ManualItem[];
  /** Their homes RentCast keeps up to date: the address and last range, for the editor. Never the household's. */
  homeValues: HomeValuation[];
  /** Their crypto wallets, as read on this visit, for Connections. Never the household's. */
  wallets: Wallet[];
  /** The history they imported, for Connections: what each import is, never its rows. */
  imports: ImportSummary[];
  /** Imports that won't open any more (a retired vault key), listed on Connections so they can be removed. */
  lockedImports: LockedImport[];
  /** Whose money this is: the person's own, or what their household shared. */
  view: "me" | "household";
  /** They're in a household, so the Me / Household switch applies. */
  inHousehold: boolean;
  /** In the Household view: the version each shared list is saved from, and who changed it last. Null in Me. */
  householdPlan: Omit<HouseholdPlan, "budgets" | "goals"> | null;
  /** The shops whose every purchase the person splits the same way (finance/details.ts), for Spending. Never the household's. */
  splitRules: ({ key: string } & SplitRule)[];
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
  /** What they own or owe that no bank reports, added by hand. A device keeps none. */
  manual: ManualItem[];
  /** Where their homes are, for RentCast. A device keeps none. */
  homeValues: HomeValuation[];
  /** Their wallets, and where new readings go (never for a connected app). A device keeps none. */
  wallets: WalletSource;
  /** History they imported from a file. A device keeps none. */
  imports: ImportedHistory[];
  /** Who their Venmo, PayPal and Cash App payments were for (finance/p2p.ts). A device keeps none. */
  p2p: P2pNotes;
  /** What their Amazon charges paid for (finance/orders.ts). A device keeps none. */
  orders: OrderNotes;
  /** Their splits, tags and who owes them (finance/details.ts). A device keeps none. */
  details: TxnDetails;
  /** Imports that won't open under any key this deployment has. A device keeps none. */
  lockedImports: LockedImport[];
  /** They're in a household. A device never is. */
  inHousehold: boolean;
  /** They share Coinbase with their household: the value last copied for it, and when. A device never does. */
  coinbaseShared: AccountSources["coinbaseShared"];
  items: VaultItem[];
  /** A live Coinbase access token — or null for a dead link — fetched on demand; never asked while it rests (`paused`, Prism Plus ended). */
  coinbase: { config: CoinbaseConfig; token: () => Promise<string | null>; paused?: true } | null;
  feedUpdatedAt: string | null;
  /** The zone the account last saw the person in. */
  timeZone: string | null;
  /** The language the account last saw the person read Prism in. Null on a device-only visit. */
  language: Locale | null;
  /** Each bank's stored sync, and whether a new one may be saved (never for a connected app). Null on a device-only visit. */
  plaidSync: PlaidSync | null;
  /** Their alert email choices and snapshot's age. Null on a device-only visit. */
  alerts: AccountSources["alerts"] | null;
};

/** Where a bank's sync starts from, and where a newer one goes — `save` is null when nothing may be written. */
type PlaidSync = {
  stored: Map<string, StoredSync>;
  save: ((itemId: string, state: SyncState, fromVersion: number, startedAt: string) => void) | null;
  /** Where a bank's warning is cleared once Plaid answers (sign-in, revoked only) — null when nothing may be written. */
  clear: ((itemId: string) => void) | null;
  /** The morning check (alert emails): balances and new transactions only, never holdings or a card's terms. */
  minimal?: boolean;
};

/**
 * Wallets as last read, where fresher readings go, and who reads a whole
 * wallet after the response — `save` and `scan` are null when nothing may be
 * written (a device, a connected app), and whole wallets then show their last reading.
 */
type WalletSource = {
  list: Wallet[];
  save: ((fresh: Fresh) => void) | null;
  scan: ((wallets: Wallet[]) => void) | null;
  /** The morning check: wallets as last read, asking no one (mempool.space and Alchemy hear from Prism only while it's in use). */
  offline?: boolean;
};

/** `p2p` and `orders` are left out where nothing reads them: the morning check never does. Splits change totals, so it reads `details`. */
export type Money = Pick<Sources, "items" | "coinbase" | "plaidSync" | "categories" | "manual" | "imports" | "wallets"> & { p2p?: P2pNotes; orders?: OrderNotes; details?: TxnDetails };

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
    // Imports are loaded even for a plan edit: without them, someone whose only money is imported would read as the demo.
    const [a, plus] = await Promise.all([loadAccount(account, key, { withSync, withImports: true }), plusFor(account)]);
    // Once Prism Plus ends, the free plan's first connection keeps updating; the rest show as last read, and Coinbase rests.
    const paused = plus.plus ? new Set<string>() : pausedBeyondFree(a.items);
    // Seals an older vault key made move to the current one, after the response (vault.ts, "Keyring").
    if (a.reseal) after(a.reseal);
    // A home due this month's estimate gets it after the response, on a visit that draws money (never a plan edit).
    if (withSync && key && plus.plus && homeValuesEnabled() && a.homeValues.length) {
      const today = todayIn(jar.get("prism-tz")?.value);
      if (a.manual.some((i) => valuationDue(i, a.homeValues.find((h) => h.itemId === i.id), monthKey(today)))) {
        // The next visit draws the new value: pages are rendered fresh each time.
        after(() =>
          refreshDueHomeValues(account, key, today).catch((e: unknown) =>
            // No address or amount in the message: only that an estimate waits for next time.
            console.error("Prism: a home's estimate wasn't saved:", e instanceof Error ? e.name : "unknown error"),
          ),
        );
      }
    }
    const record = a.coinbase;
    return {
      account,
      firstName: a.firstName,
      plan: a.plan,
      categories: a.categories,
      manual: a.manual,
      homeValues: a.homeValues,
      wallets: {
        list: a.wallets,
        // After the response: this visit already shows the new reading; the kept one spares the next visit a wait.
        save: key
          ? (fresh) =>
              after(() =>
                saveWalletReadings(account, fresh, key).catch((e: unknown) =>
                  // No address or balance in the message: only that a reading wasn't kept.
                  console.error("Prism: a wallet's reading wasn't kept:", e instanceof Error ? e.name : "unknown error"),
                ),
              )
          : null,
        // Whole wallets: read after the response, never while the page waits.
        scan: key ? (wallets) => after(() => refreshWholeWallets(account, wallets, key)) : null,
      },
      imports: a.imports,
      p2p: a.p2pNotes,
      orders: a.orderNotes,
      details: a.details,
      lockedImports: a.lockedImports,
      inHousehold: a.inHousehold,
      coinbaseShared: a.coinbaseShared,
      items: plaid ? a.items.map((i) => (paused.has(i.itemId) ? { ...i, paused: true as const } : i)) : [],
      coinbase: cb && key && record ? { config: cb, token: () => liveCoinbaseToken(account, record, cb, key), ...(plus.plus ? {} : { paused: true as const }) } : null,
      feedUpdatedAt: a.feedUpdatedAt,
      timeZone: a.timeZone,
      language: a.language,
      alerts: a.alerts,
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
        // After the response too: a bank that answered is no longer waiting on a sign-in. Never a consent still running out.
        clear: (itemId) =>
          after(() =>
            clearBankAttention(account, itemId, { only: ["sign-in", "revoked"] }).catch((e: unknown) =>
              console.error("Prism: a bank's warning wasn't cleared:", e instanceof Error ? e.name : "unknown error"),
            ),
          ),
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
    manual: [],
    homeValues: [],
    wallets: { list: [], save: null, scan: null },
    imports: [],
    p2p: NO_P2P_NOTES,
    orders: NO_ORDER_NOTES,
    details: NO_DETAILS,
    lockedImports: [],
    inHousehold: false,
    coinbaseShared: null,
    items: plaid ? vaultItems(jar) : [],
    coinbase: cb && link ? { config: cb, token: async () => (isExpired(link) ? null : link.accessToken) } : null,
    feedUpdatedAt: null,
    timeZone: null,
    language: null,
    // A device keeps no sync: its banks are read in full each time, as before accounts.
    plaidSync: null,
    alerts: null,
  };
}

const getSources = cache(() => readSources({ withSync: true }));

/** Anything of the person's own — a bank, Coinbase, or something they added — replaces the example household. */
const isLive = (s: Money) => s.items.length > 0 || s.coinbase !== null || s.manual.length > 0 || s.imports.length > 0 || s.wallets.list.length > 0;

/**
 * The goals the data source provides before any edit — the demo household's,
 * or none once anything real is linked. Cheap: never calls a bank.
 */
export async function sourceGoals(sources?: Sources): Promise<Goal[]> {
  const s = sources ?? (await readSources());
  return isLive(s) ? [] : buildDemoData(await requestToday()).goals;
}

export type Carryover = { text: string; n?: number };

/** Money or plans a signed-in person still has on this device from before they signed in. */
function carryoverOf(jar: Jar, signedIn: boolean): Carryover[] {
  if (!signedIn || jar.get(CARRYOVER_COOKIE)?.value === "later") return [];
  const out: Carryover[] = [];
  const banks = plaidConfig() ? vaultItems(jar).length : 0;
  if (banks) out.push(banks === 1 ? { text: msg("a linked bank") } : { text: msg("{n} linked banks"), n: banks });
  if (coinbaseConfig() && safeVaultKey() && readLink(jar.get(COINBASE_COOKIE)?.value, safeVaultKey()!)) out.push({ text: "Coinbase" });
  // Decoded, not merely present: a cookie deleted by an action in this same
  // request is still listed during the re-render, with an empty value.
  const plan = readPlan(jar);
  if (plan.budgets) out.push({ text: msg("your budgets") });
  if (plan.goals) out.push({ text: msg("your goals") });
  return out;
}

type Live = Omit<Loaded, "localHour" | "planEdited" | "accountsEnabled" | "account" | "carryover" | "manual" | "homeValues" | "wallets" | "imports" | "lockedImports" | "view" | "inHousehold" | "householdPlan" | "splitRules">;

/**
 * The money itself: the demo household when nothing real is linked (real and
 * made-up money are never shown together, so linking anything ends the
 * demo), else every bank and Coinbase, fetched in parallel.
 */
async function moneyFor(src: Money, today: ISODate, coinbaseLapsed?: string): Promise<{ money: Live; wallets: Wallet[]; undetailed?: Transaction[] }> {
  const config = plaidConfig();
  if (!isLive(src)) return { money: { ...buildDemoData(today), notice: null, plaidReady: config !== null }, wallets: [] };
  const [banks, crypto, read] = await Promise.all([
    config && src.items.length ? loadPlaid(config, src.items, today, src.plaidSync, src.categories) : Promise.resolve(emptyLive(today, config !== null)),
    src.coinbase?.paused
      ? Promise.resolve(pausedCoinbase())
      : src.coinbase
        ? src.coinbase.token().then((t) => loadCoinbase(src.coinbase!.config, t, coinbaseLapsed))
        : Promise.resolve(null),
    src.wallets.offline ? Promise.resolve({ wallets: src.wallets.list, fresh: new Map() as Fresh, later: [] as Wallet[] }) : readWallets(src.wallets.list),
  ]);
  if (read.fresh.size) src.wallets.save?.(read.fresh);
  if (read.later.length) src.wallets.scan?.(read.later);
  const none = { banks: src.items.length === 0 && !src.coinbase, manual: src.manual.length === 0, imports: src.imports.length === 0, wallets: read.wallets.length === 0 };
  const money = crypto ? withCoinbase(banks, crypto) : banks;
  const owned = withManual(money, src.manual, today, none.banks && none.imports && none.wallets);
  const imported = withImports(owned, src.imports, src.categories, none.banks && none.manual && none.wallets);
  const all = withWallets(imported, read.wallets, none.banks && none.manual && none.imports);
  // Who each Venmo, PayPal or Cash App line was for: the person's own notes, on their own lines.
  const paid = src.p2p ? applyP2pNotes(all.transactions, src.p2p) : all.transactions;
  // And what each Amazon charge paid for, from their own order history.
  const noted = src.orders ? applyOrderNotes(paid, src.orders) : paid;
  // Then what they added themselves: a split becomes its parts, after their category fixes.
  const detailed = src.details ? applyDetails(noted, src.details) : noted;
  // The household sees each line as the bank sent it (undetailed): the same figures for every member. A person's own payment
  // and order notes stay on their own lines in their own view of it; no other member is ever sent them (household_shared_money).
  return { money: detailed === all.transactions ? all : { ...all, transactions: detailed }, wallets: read.wallets, undetailed: noted };
}

/** Wallets added by address, as accounts under "Your wallets", each with a holding per asset. */
function withWallets(base: Live, wallets: Wallet[], only: boolean): Live {
  if (wallets.length === 0) return base;
  const money = wallets.map(walletMoney);
  return {
    ...base,
    source: only ? "wallet" : base.source,
    institutions: [...base.institutions, walletsInstitution(wallets)],
    accounts: [...base.accounts, ...money.map((m) => m.account)],
    holdings: [...base.holdings, ...money.flatMap((m) => m.holdings)],
  };
}

/**
 * What the household never sees of mine, whatever I share: history I
 * imported stays mine, even the older history of an account I share (the
 * other members see only the bank's own copy of it).
 */
function privateToMe(mine: Live): Live {
  const wallet = (id: string) => id.startsWith("wallet-");
  return {
    ...mine,
    transactions: mine.transactions.filter((t) => !t.id.startsWith("imp-")),
    accounts: mine.accounts.filter((a) => a.source !== "import" && a.source !== "wallet"),
    institutions: mine.institutions.filter((i) => i.source !== "import" && i.source !== "wallet"),
    holdings: mine.holdings.filter((h) => !wallet(h.accountId)),
  };
}

/**
 * History imported from a file. Older history of a linked account joins that
 * account, but only from before the bank's own earliest transaction, so no
 * day is counted twice; the rest is an account of its own under "Imported"
 * (a closed account, say), with no balance Prism can know. Transaction ids
 * are the import's and the row's place in it, so a category fixed for one
 * stays fixed. A linked account that's gone makes its history an account of
 * its own again.
 */
function withImports(base: Live, imports: ImportedHistory[], rules: CategoryRules, only: boolean): Live {
  if (imports.length === 0) return base;
  const accounts = [...base.accounts];
  const institutions = [...base.institutions];
  const added: Transaction[] = [];
  for (const imp of imports) {
    const target = imp.meta.attachTo ? base.accounts.find((a) => a.id === imp.meta.attachTo && a.source === "plaid") : undefined;
    const accountId = target ? target.id : importAccountId(imp.id);
    let before: ISODate | null = null;
    if (target) for (const t of base.transactions) if (t.accountId === target.id && (before === null || t.date < before)) before = t.date;
    imp.rows.forEach((r, n) => {
      if (before !== null && r.date >= before) return;
      added.push({ id: `imp-${imp.id}-${n}`, accountId, date: r.date, amount: r.amount, merchant: r.merchant, category: r.category, pending: false });
    });
    if (!target) {
      accounts.push({ id: accountId, institutionId: accountId, name: imp.meta.name, mask: null, kind: imp.meta.kind, balance: 0, history: new Array<Cents>(13).fill(0), source: "import" });
      institutions.push({ id: accountId, name: imp.meta.name, health: "healthy", lastSyncedAt: null, source: "import" });
    }
  }
  const transactions = [...base.transactions, ...recategorize(added, rules)].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { ...base, source: only ? "import" : base.source, accounts, institutions, transactions };
}

/** What the person added by hand, as accounts under "Added by you". Only things added by hand? Then that's the household's source. */
function withManual(base: Live, items: ManualItem[], today: ISODate, only: boolean): Live {
  if (items.length === 0) return base;
  return {
    ...base,
    source: only ? "manual" : base.source,
    institutions: [...base.institutions, manualInstitution()],
    accounts: [...base.accounts, ...items.map((i) => manualAccount(i, today))],
  };
}

/** The greeting belongs to whoever is signed in — even over the demo's example money, which is still Alex's household. */
function greeted(base: Live, firstName: string | null, live: boolean): Live {
  return { ...base, household: { name: firstName && live ? `${firstName}'s household` : base.household.name, firstName: firstName ?? "there" } };
}

/** "household" while the person looks at their household's shared money; anything else is their own. */
export const VIEW_COOKIE = "prism-view";

/** The person's own money whatever the switch says: Connections and the Account page are theirs alone. */
export const getPersonalFinance = cache(async (): Promise<Loaded> => (await ownMoney()).loaded);

/** The page's money, as the Me / Household switch has it. */
export const getFinance = cache(async (): Promise<Loaded> => {
  // One load of the person's own money per request, whichever of the two a layout and its page ask for.
  const { loaded, base, shared, src, today } = await ownMoney();
  if ((await cookies()).get(VIEW_COOKIE)?.value !== "household" || !src.account || !src.inHousehold) return loaded;
  // The shared view is part of Prism Plus: someone in the household has to have it (the switch says so).
  if (!(await plusFor(src.account)).householdView) return loaded;
  try {
    // After the calendar's refresh in ownMoney: the feed is only ever the person's own bills.
    return { ...loaded, ...(await householdFor(src.account, isLive(src) ? shared : null, today)), notice: base.notice, view: "household", splitRules: [], hiddenAccounts: [], hiddenHoldings: [] };
  } catch {
    return { ...loaded, notice: "We couldn't load your household just now. This is your own money." };
  }
});

const ownMoney = cache(async (): Promise<{ loaded: Loaded; base: Live; shared: Live; src: Sources; today: ISODate }> => {
  const jar = await cookies();
  const zone = jar.get("prism-tz")?.value;
  const today = todayIn(zone);
  const localHour = hourIn(zone);
  const t = await getT();
  const src = await getSources();
  const planEdited = { budgets: src.plan.budgets !== null, goals: src.plan.goals !== null };

  const own = await moneyFor(src, today);
  let base = own.money;
  if (src.account) {
    if (isLive(src)) await refreshFeedIfStale(src.account, src.feedUpdatedAt, base, t.locale, src.language !== t.locale);
    base = greeted(base, src.firstName, isLive(src));
    rememberZone(src.account, src.timeZone, zone);
    rememberLanguage(src.account, src.language, t.locale);
    if (src.coinbaseShared) rememberCoinbase(src.account, src.coinbaseShared, base);
  }
  // The person's own edits win over seeded or drafted budgets and goals; then the accounts they left out of their totals step aside.
  const personal: Loaded = {
    ...hideAccounts(applyPlan(base, src.plan), src.details ?? null),
    localHour,
    planEdited,
    accountsEnabled: supabaseEnv() !== null,
    account: src.account
      ? {
          email: src.account.email,
          firstName: src.firstName,
          calendarFeed: src.feedUpdatedAt !== null,
          alerts: src.alerts ? { on: src.alerts.on, kinds: src.alerts.kinds, amounts: src.alerts.amounts, refresh: src.alerts.refresh } : null,
        }
      : null,
    carryover: carryoverOf(jar, src.account !== null),
    manual: src.manual,
    homeValues: src.homeValues,
    wallets: own.wallets,
    imports: src.imports.map(summarize),
    lockedImports: src.lockedImports,
    view: "me",
    inHousehold: src.inHousehold,
    householdPlan: null,
    splitRules: Object.entries(src.details?.rules ?? {}).map(([key, rule]) => ({ key, ...rule })),
  };
  if (src.account) rememberAlerts(src.account, src.alerts, isLive(src) ? personal : null, t, src.language !== t.locale);
  // What the household is shown of my own money: my lines without my splits, tags or who owes me.
  const shared: Live = own.undetailed ? { ...base, transactions: own.undetailed } : base;
  return { loaded: personal, base, shared, src, today };
});

/**
 * The Household view: my shared accounts, and each other member's, from the
 * sealed copies the database hands back (never a token), opened here and
 * narrowed to exactly what each of them shared.
 */
async function householdFor(account: Account, mine: Live | null, today: ISODate): Promise<FinanceData & Pick<Loaded, "planEdited" | "householdPlan">> {
  const key = safeVaultKey();
  const [shares, rows, plan] = await Promise.all([loadShares(account), loadSharedMoney(account), loadHouseholdPlan(account)]);
  if (!plan) throw new Error("Not in a household any more.");
  const others = key ? rows.map((r) => openMember(r, key, today)) : [];
  const own = privateToMe(mine ?? emptyLive(today, plaidConfig() !== null));
  const data = householdData(own, new Set(shares.keys()), { userId: account.userId, name: "You" }, others);
  const { budgets, goals, ...versions } = plan;
  return {
    ...data,
    // The household's own plan; until someone sets budgets, they're drafted from what the household shares.
    budgets: budgets ?? draftBudgets(data.transactions, today),
    // A household goal can follow any shared account; its id means the same account to every member.
    goals: followAccounts((goals ?? []).map((g) => toGoal(g, undefined)), data.accounts),
    planEdited: { budgets: budgets !== null, goals: goals !== null },
    householdPlan: versions,
  };
}

function openMember(row: SharedMoneyRow, key: VaultKey, today: ISODate): MemberMoney {
  const rules = row.sealedCategoryRules ? validCategoryRules(openPacked(row.sealedCategoryRules, key)) : NO_RULES;
  const institutions: Institution[] = [];
  const accounts: FinanceData["accounts"] = [];
  const transactions: FinanceData["transactions"] = [];
  for (const item of row.items) {
    const state = validState(openPacked(item.sealedSync, key));
    if (!state?.accounts) continue;
    const txns = state.transactions.map(mapTransaction);
    transactions.push(...txns);
    accounts.push(...state.accounts.map((a) => mapAccount(a, item.itemId, txns, today)));
    // "As of" is their last visit: nobody else's visit syncs their bank.
    institutions.push({ id: item.itemId, name: item.institutionName ?? "Their bank", health: "healthy", lastSyncedAt: item.syncedAt, source: "plaid" });
  }
  const coinbase = row.coinbase?.sealed ? validCoinbaseValue(openPacked(row.coinbase.sealed, key)) : null;
  if (coinbase) {
    // As of their last visit: nobody else's visit reaches their Coinbase.
    const { institution, account } = sharedCoinbase(coinbase, row.coinbase!.at);
    institutions.push(institution);
    accounts.push(account);
  }
  const manual = row.sealedManualItems ? validManualItems(openPacked(row.sealedManualItems, key)) : [];
  if (manual.length) {
    institutions.push(manualInstitution());
    accounts.push(...manual.map((i) => manualAccount(i, today)));
  }
  const all = { institutions, accounts, transactions: recategorize(transactions, rules) };
  return { userId: row.userId, name: row.firstName ?? "Household member", ...narrowTo(all, new Set(row.sharedAccountIds)) };
}

/**
 * The household sees a shared Coinbase as the value copied on its owner's
 * own visits (never anyone else's, and never a connected app's). Refreshed
 * after the response, at most every ten minutes, and only from a live load:
 * if Coinbase couldn't be reached, the last copy stands.
 */
function rememberCoinbase(account: Account, shared: { balance: number | null; at: string | null }, base: Live): void {
  const live = base.accounts.find((a) => a.source === "coinbase");
  const key = safeVaultKey();
  if (!live || !key || live.balance === shared.balance) return;
  if (shared.at && Date.now() - Date.parse(shared.at) < COINBASE_COPY_EVERY) return;
  after(() => saveCoinbaseValue(account, Math.max(0, live.balance), key).catch(() => undefined));
}
const COINBASE_COPY_EVERY = 10 * 60_000;

/**
 * What this visit found worth an alert, left for the email job (which can't
 * read anyone's money itself): after the response, only for someone who
 * turned emails on, from their own money (never the household's or the
 * demo's), in the language of the page, and at most every quarter hour unless
 * the last one was sealed under an older vault key or written in the language
 * they've just left. Once nothing of theirs is live, the last one goes.
 */
function rememberAlerts(account: Account, alerts: Sources["alerts"], money: FinanceData | null, t: T, newLanguage: boolean): void {
  if (!alerts?.on) return;
  const key = safeVaultKey();
  if (!key) return;
  if (!money) {
    if (alerts.takenAt) after(() => forgetAlertSnapshot(account).catch(() => undefined));
    return;
  }
  if (alerts.takenAt && !alerts.stale && !newLanguage && Date.now() - Date.parse(alerts.takenAt) < ALERT_SNAPSHOT_EVERY) return;
  after(() =>
    saveAlertSnapshot(account, alertSnapshot(analyze(money, t), new Date().toISOString(), "visit", t), key).catch((e: unknown) =>
      // No figure in the message: only that the job will use the last one.
      console.error("Prism: a visit's alert snapshot wasn't kept:", e instanceof Error ? e.name : "unknown error"),
    ),
  );
}
const ALERT_SNAPSHOT_EVERY = 15 * 60_000;

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
 * Keep the language Prism writes to them in (alert emails, phone alerts) the
 * one they read it in: their pick on the toggle, else their browser's. After
 * the response, and only when it moved.
 */
function rememberLanguage(account: Account, stored: Locale | null, seen: Locale): void {
  if (seen === stored) return;
  after(() => saveAccountLanguage(account, seen).catch(() => undefined));
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
  const a = await loadAccount(account, key, { strict: true, withSync: true, withImports: true });
  const timeZone = validZone(a.timeZone) ?? "UTC";
  const today = todayIn(timeZone);
  const record = a.coinbase;
  const src: Money = {
    items: plaid ? a.items : [],
    // Catch up from the stored cursor in memory; a connected app never saves (and the database wouldn't let it).
    plaidSync: { stored: a.plaidSync, save: null, clear: null },
    categories: a.categories,
    manual: a.manual,
    imports: a.imports,
    p2p: a.p2pNotes,
    orders: a.orderNotes,
    details: a.details,
    // Read again in memory when stale; a connected app never saves (and the database wouldn't let it).
    wallets: { list: a.wallets, save: null, scan: null },
    coinbase: cb && key && record ? { config: cb, token: async () => (isExpired(record.tokens, Date.now() + 60_000) ? null : record.tokens.accessToken) } : null,
  };
  const base = greeted((await moneyFor(src, today, "Coinbase balances update the next time you open Prism.")).money, a.firstName, isLive(src));
  const planned = hideAccounts(applyPlan(base, a.plan), a.details);
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
    hiddenAccounts: planned.hiddenAccounts,
    credit: planned.credit,
    notice: planned.notice,
    demo: !isLive(src),
    timeZone,
    budgetsSetByPerson: a.plan.budgets !== null,
  };
}

/**
 * The person's own money for the alert job's morning check, from sources it
 * opened itself (src/lib/alerts/refresh.ts), drawn exactly as a visit draws
 * it, plan and all. Null when nothing of theirs is live: the example
 * household is never anyone's alert.
 */
export async function morningFinance(src: Money, plan: Plan, today: ISODate): Promise<FinanceData | null> {
  if (!isLive(src)) return null;
  return hideAccounts(applyPlan((await moneyFor(src, today)).money, plan), src.details ?? null);
}

const FEED_STALE_MS = 6 * 60 * 60_000;

/**
 * The calendar feed's snapshot, written again every six hours of visits, in
 * the language of the page, and at once when they've just changed language,
 * so their calendar follows them. Only for someone who has a feed.
 */
async function refreshFeedIfStale(account: Account, updatedAt: string | null, data: Live, lang: Locale, newLanguage: boolean): Promise<void> {
  if (!updatedAt || (!newLanguage && Date.now() - Date.parse(updatedAt) < FEED_STALE_MS)) return;
  // No key, no refresh: a snapshot is only ever stored sealed.
  const key = safeVaultKey();
  if (!key) return;
  try {
    await saveFeedSnapshot(account, feedSnapshot(data, lang), key);
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
      institution: coinbaseNeedsSignIn(reauth),
      account: null,
      holdings: [],
      problem: reauth ? "Coinbase needs you to sign in again." : "We couldn't reach Coinbase just now.",
    };
  }
}

/** Coinbase while it rests: still listed, so it can be disconnected, but asked nothing and counted nowhere. */
function pausedCoinbase(): CoinbaseLoad {
  return { institution: { ...coinbaseNeedsSignIn(false), health: "healthy", paused: true }, account: null, holdings: [], problem: null };
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
 * time. If Plaid can't be reached, or the bank needs the person to sign in
 * again, the last copy still stands (and the page says so): a bank waiting
 * on its owner mustn't vanish from their net worth and goals meanwhile, nor
 * show them less than their household already sees of it.
 */
async function bankFor(
  config: PlaidConfig,
  item: VaultItem,
  sync: PlaidSync | null,
  today: ISODate,
): Promise<{
  accounts: PlaidAccount[];
  transactions: PlaidTransaction[];
  liabilities: StoredLiability[];
  ready: boolean;
  syncedAt: string;
  fromCopy: boolean;
  signInAgain: boolean;
  /** Plaid answered just now (not a stored copy served without asking): proof the bank's sign-in works. */
  answered: boolean;
}> {
  const stored = sync?.stored.get(item.itemId) ?? null;
  const copy = stored?.state ?? null;
  const kept = copy?.liabilities?.list ?? [];
  // A paused connection is never asked: its last copy, or nothing.
  if (item.paused) {
    return { accounts: copy?.accounts ?? [], transactions: copy?.transactions ?? [], liabilities: kept, ready: true, syncedAt: stored?.syncedAt ?? "", fromCopy: false, signInAgain: false, answered: false };
  }
  if (copy?.accounts && !needsSync(stored)) {
    return { accounts: copy.accounts, transactions: copy.transactions, liabilities: kept, ready: copy.ready, syncedAt: stored!.syncedAt!, fromCopy: false, signInAgain: false, answered: false };
  }
  const startedAt = new Date().toISOString();
  let next: SyncState;
  try {
    const [acc, synced] = await Promise.allSettled([getAccounts(config, item.accessToken), syncTransactions(config, item.accessToken, copy, { today })]);
    if (acc.status === "rejected") throw acc.reason;
    if (synced.status === "fulfilled") next = { ...synced.value, accounts: acc.value.accounts };
    // An investment account on its own has no transactions to give, so Plaid refusing them is no outage: its holdings are the news.
    else if (holdingsOnly(acc.value.accounts)) next = { v: 1, cursor: "", transactions: [], ready: true, accounts: acc.value.accounts };
    else throw synced.reason;
  } catch (e) {
    if (copy?.accounts && stored?.syncedAt) {
      return { accounts: copy.accounts, transactions: copy.transactions, liabilities: kept, ready: copy.ready, syncedAt: stored.syncedAt, fromCopy: true, signInAgain: isReauth(e), answered: false };
    }
    throw e;
  }
  // A card's or a loan's terms: billed per bank from the first read, so only when switched on, only for a bank that
  // holds one, at most daily, and never for a connected app (it can't keep what it reads, so it would read again).
  let liabilities = copy?.liabilities ?? null;
  const mayRead = (sync === null || sync.save !== null) && !sync?.minimal;
  if (mayRead && liabilitiesEnabled() && holdsDebt(next.accounts ?? []) && liabilitiesStale(liabilities)) {
    try {
      liabilities = { at: startedAt, list: await getLiabilities(config, item.accessToken) };
    } catch (e) {
      // No bank data in the message: Plaid's code and reason only. The last terms stand, and today's attempt counts.
      console.warn(`Plaid Liabilities not read for a bank: ${e instanceof Error ? e.message : "unknown error"}`);
      liabilities = { at: startedAt, list: liabilities?.list ?? [] };
    }
  }
  if (liabilities) next = { ...next, liabilities };
  // Outside the try: a problem keeping the copy is never mistaken for Plaid being down.
  sync?.save?.(item.itemId, next, stored?.version ?? 0, startedAt);
  return { accounts: next.accounts ?? [], transactions: next.transactions, liabilities: liabilities?.list ?? [], ready: next.ready, syncedAt: startedAt, fromCopy: false, signInAgain: false, answered: true };
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
        // Shown only while reading them is switched on: terms that stopped updating would go quietly out of date.
        const terms = liabilitiesEnabled() ? new Map(bank.liabilities.map((l) => [l.account_id, l])) : null;
        accounts.push(
          ...bank.accounts.map((a) => {
            const account = mapAccount(a, item.itemId, txns, today);
            const t = terms?.get(a.account_id);
            return t ? { ...account, liability: toLiability(t, today) } : account;
          }),
        );
        // Plaid's own warning (plaid_bank_warning) stands until Plaid answers again: an answer ends a sign-in or a withdrawal.
        let warning = item.attention;
        if (warning && bank.answered && warning.state !== "disconnecting") {
          sync?.clear?.(item.itemId);
          warning = undefined;
        }
        const signIn = bank.signInAgain || warning?.state === "sign-in" || warning?.state === "revoked";
        const disconnectsAt = !signIn && warning?.state === "disconnecting" ? warning.disconnectAt : null;
        institutions.push(
          item.paused
            ? { id: item.itemId, name, health: "healthy", paused: true, lastSyncedAt: bank.syncedAt || null, source: "plaid" }
            : signIn
              ? { id: item.itemId, name, health: "needs_attention", signInAgain: true, lastSyncedAt: bank.syncedAt, source: "plaid" }
              : { id: item.itemId, name, health: bank.ready ? "healthy" : "syncing", lastSyncedAt: bank.syncedAt, source: "plaid", ...(disconnectsAt ? { disconnectsAt } : {}) },
        );
        // A paused bank is no problem to fix: Connections says why, and what brings it back.
        if (signIn && !item.paused) problems.push(`${name} needs you to sign in again — showing it as of the last sync.`);
        else if (bank.fromCopy) problems.push(`${name} couldn't be updated just now — showing it as of the last sync.`);
        // Holdings aren't kept in the copy, and a bank waiting on a sign-in would only refuse again.
        if (!signIn && !item.paused && !sync?.minimal && bank.accounts.some((a) => a.type === "investment" || a.type === "brokerage")) {
          try {
            const h = await getHoldings(config, item.accessToken);
            holdings.push(...mapHoldings(h.holdings, h.securities));
          } catch {
            // Investments were an optional product; no consent is not an error.
          }
        }
      } catch (e) {
        const reauth = isReauth(e);
        institutions.push({ id: item.itemId, name, health: "needs_attention", ...(reauth ? { signInAgain: true as const } : {}), lastSyncedAt: null, source: "plaid" });
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
  const budgets = draftBudgets(fixed, today);

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
