// src/lib/server/account-store.ts
//
// Everything a signed-in person keeps in their account, read and written AS
// that person (row-level security does the guarding). Tokens are sealed with
// PRISM_VAULT_KEY before they leave this process and opened only here; the
// database only ever holds ciphertext.

import "server-only";
import { randomBytes } from "node:crypto";
import { refreshTokens, type CoinbaseConfig, type TokenSet } from "@/lib/coinbase/client";
import { validCoinbaseValue } from "@/lib/coinbase/map";
import { hasRules, NO_RULES, validCategoryRules, type CategoryRules } from "@/lib/finance/category-rules";
import { assembleImports, type ImportedHistory, type LockedImport } from "@/lib/finance/import";
import { storedHomeValues, validHomeValues, type HomeValuation } from "@/lib/finance/home-value";
import { validManualItems, type ManualItem } from "@/lib/finance/manual";
import { hasDetails, NO_DETAILS, validDetails, type TxnDetails } from "@/lib/finance/details";
import { NO_P2P_NOTES, validP2pNotes, type P2pNotes } from "@/lib/finance/p2p";
import { NO_ORDER_NOTES, validOrderNotes, type OrderNotes } from "@/lib/finance/orders";
import { storedWallets, validWallets, walletStale, type Reading, type Script, type Wallet } from "@/lib/crypto/wallets";
import { validBudgets, validGoals, type GoalSettings, type Plan } from "@/lib/finance/plan";
import type { AlertSnapshot } from "@/lib/finance/alert-snapshot";
import { ALERT_CHOICES, isAlertChoice, type AlertChoice } from "@/lib/alerts/choices";
import type { Budget } from "@/lib/finance/types";
import type { Account } from "@/lib/supabase/server";
import { needsRefresh } from "./coinbase-store";
import { feedTokenHash, openFeedSnapshot, sealFeedSnapshot } from "./feed-token";
import { validState, type StoredSync, type SyncState } from "@/lib/plaid/sync";
import { needsReseal, openJson, openPacked, sealJson, sealPacked, type BankAttention, type VaultItem, type VaultKey } from "./vault";

type ProfileRow = {
  first_name: string | null;
  plan_budgets: unknown;
  plan_goals: unknown;
  time_zone: string | null;
  sealed_category_rules: string | null;
  sealed_manual_items: string | null;
  sealed_home_values: string | null;
  sealed_wallets: string | null;
  sealed_p2p_notes?: string | null;
  sealed_txn_details?: string | null;
  sealed_order_notes?: string | null;
  alert_email?: boolean;
  alert_kinds?: unknown;
  alert_amounts?: boolean;
  alert_refresh?: boolean;
  updated_at: string;
};
type AlertSnapshotRow = { sealed: string; updated_at: string };
type PlaidRow = {
  item_id: string;
  sealed_token: string;
  institution_id: string | null;
  institution_name: string | null;
  linked_at: string;
  sealed_sync: string | null;
  sync_version: number;
  synced_at: string | null;
  changed_at: string | null;
  attention?: string | null;
  disconnect_at?: string | null;
};
type CoinbaseRow = { sealed_tokens: string; expires_at: string; version: number; linked_at: string; sealed_snapshot?: string | null; snapshot_at?: string | null };
type FeedRow = { updated_at: string; sealed_token: string };

type ImportPartRow = { import_id: string; part: number; sealed: string; created_at: string };
export type CoinbaseRecord = { tokens: TokenSet; version: number; linkedAt: string };
/** What a person chose for alert emails (Account page). */
export type AlertSettings = { on: boolean; kinds: AlertChoice[]; amounts: boolean; refresh: boolean };

export type AccountSources = {
  firstName: string | null;
  timeZone: string | null;
  plan: Plan;
  /** The person's category fixes; none when there are none, or none open under the vault key. */
  categories: CategoryRules;
  /** What they own or owe that no bank reports, added by hand. */
  manual: ManualItem[];
  /** Homes whose value RentCast keeps up to date: their addresses, never shared with a household. */
  homeValues: HomeValuation[];
  /** Crypto wallets added by public address, with their last readings; never shared with a household. */
  wallets: Wallet[];
  /** Who their Venmo, PayPal and Cash App payments were for, by bank transaction; never shared with a household. */
  p2pNotes: P2pNotes;
  /** What their Amazon charges paid for, by bank transaction; never shared with a household. */
  orderNotes: OrderNotes;
  /** Their splits, tags and who owes them, by bank transaction; never shared with a household. */
  details: TxnDetails;
  /** History they imported from a file, finished imports only — empty unless asked for. */
  imports: ImportedHistory[];
  /** Imports no key in the ring opens, so they can be removed; none when there's no key at all. */
  lockedImports: LockedImport[];
  items: VaultItem[];
  /** Each linked bank's stored sync (cursor, transactions, balances), by item id — empty unless asked for. */
  plaidSync: Map<string, StoredSync>;
  coinbase: CoinbaseRecord | null;
  /**
   * They share Coinbase with their household: the value the household was
   * last shown (null before the first copy), and when. Null when they don't.
   */
  coinbaseShared: { balance: number | null; at: string | null } | null;
  feedUpdatedAt: string | null;
  /** They're in a household, so the Me / Household switch applies. */
  inHousehold: boolean;
  /** Their alert emails: what they chose, and when their visits last left the job a snapshot. */
  alerts: AlertSettings & { takenAt: string | null; stale: boolean };
  /**
   * Seals this account holds that the current vault key didn't make, sealed
   * again under it; null when there are none. For a caller that may write,
   * after the response. A connected app never calls it (its writes are refused).
   */
  reseal: (() => Promise<void>) | null;
};

function openCoinbase(row: CoinbaseRow | null, key: VaultKey | null): CoinbaseRecord | null {
  if (!row || !key) return null;
  const t = openJson(row.sealed_tokens, key) as Partial<TokenSet> | null;
  if (!t || typeof t.accessToken !== "string" || typeof t.refreshToken !== "string" || !Number.isFinite(t.expiresAt)) return null;
  return { tokens: { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt! }, version: row.version, linkedAt: row.linked_at };
}

/**
 * One round of parallel reads: the profile (and plan), linked banks, Coinbase,
 * and the calendar feed's age. `strict` turns a failed read into an error
 * instead of an empty account — for a connected app, which must never be told
 * "nothing is linked" (and shown the example household) because a query failed.
 */
export async function loadAccount(account: Account, key: VaultKey | null, { strict = false, withSync = false, withImports = false } = {}): Promise<AccountSources> {
  const db = account.supabase;
  const [profile, plaid, coinbase, feed, household, coinbaseShare, imported, alertSnapshot] = await Promise.all([
    db
      .from("profiles")
      .select("first_name, plan_budgets, plan_goals, time_zone, sealed_category_rules, sealed_manual_items, sealed_home_values, sealed_wallets, sealed_p2p_notes, sealed_txn_details, sealed_order_notes, alert_email, alert_kinds, alert_amounts, alert_refresh, updated_at")
      .eq("user_id", account.userId)
      .maybeSingle<ProfileRow>(),
    db
      .from("plaid_items")
      .select(
        withSync
          ? "item_id, sealed_token, institution_id, institution_name, linked_at, sealed_sync, sync_version, synced_at, changed_at, attention, disconnect_at"
          : "item_id, sealed_token, institution_id, institution_name, linked_at, attention, disconnect_at",
      )
      .eq("user_id", account.userId)
      .returns<PlaidRow[]>(),
    db.from("coinbase_links").select("sealed_tokens, expires_at, version, linked_at, sealed_snapshot, snapshot_at").eq("user_id", account.userId).maybeSingle<CoinbaseRow>(),
    db.from("calendar_feeds").select("updated_at, sealed_token").eq("user_id", account.userId).maybeSingle<FeedRow>(),
    db.from("household_members").select("household_id").eq("user_id", account.userId).limit(1),
    db.from("shared_accounts").select("account_id").eq("user_id", account.userId).eq("account_id", "coinbase").limit(1),
    withImports
      ? db.from("imported_history").select("import_id, part, sealed, created_at").eq("user_id", account.userId).returns<ImportPartRow[]>()
      : Promise.resolve({ data: [] as ImportPartRow[], error: null }),
    // A connected app is never shown one (the database refuses it), and that's no failure.
    db.from("alert_snapshots").select("sealed, updated_at").eq("user_id", account.userId).maybeSingle<AlertSnapshotRow>(),
  ]);
  if (strict && (profile.error || plaid.error || coinbase.error || feed.error || imported.error)) throw new Error("Couldn't read the account.");
  const items: VaultItem[] = [];
  const plaidSync = new Map<string, StoredSync>();
  const stale = staleSeals(account, key);
  for (const r of plaid.data ?? []) {
    const opened = key ? (openJson(r.sealed_token, key) as { accessToken?: unknown } | null) : null;
    if (typeof opened?.accessToken !== "string") continue; // sealed under another key: unusable, so unseen
    const attention = bankAttention(r);
    items.push({ itemId: r.item_id, accessToken: opened.accessToken, institutionId: r.institution_id, institutionName: r.institution_name, linkedAt: r.linked_at, ...(attention ? { attention } : {}) });
    stale.plaidToken(r, opened);
    if (!withSync) continue;
    // A copy that won't open or doesn't read as one starts over at the next sync.
    const raw = key ? openPacked(r.sealed_sync, key) : null;
    const state = validState(raw);
    plaidSync.set(r.item_id, { state, version: r.sync_version ?? 0, syncedAt: state ? r.synced_at : null, changedAt: r.changed_at ?? null });
    if (state) stale.plaidSync(r, raw);
  }
  const coinbaseRecord = openCoinbase(coinbase.data ?? null, key);
  if (coinbaseRecord) stale.coinbase(coinbase.data!, coinbaseRecord);
  const rawValue = key && coinbase.data?.sealed_snapshot ? openPacked(coinbase.data.sealed_snapshot, key) : null;
  const value = validCoinbaseValue(rawValue);
  if (value) stale.coinbaseValue(coinbase.data!, value);
  const sharesCoinbase = coinbaseRecord !== null && (coinbaseShare.data?.length ?? 0) > 0;
  if (feed.data) stale.feed(feed.data);
  const rawRules = key && profile.data?.sealed_category_rules ? openPacked(profile.data.sealed_category_rules, key) : null;
  const rawManual = key && profile.data?.sealed_manual_items ? openPacked(profile.data.sealed_manual_items, key) : null;
  const rawHomes = key && profile.data?.sealed_home_values ? openPacked(profile.data.sealed_home_values, key) : null;
  const rawWallets = key && profile.data?.sealed_wallets ? openPacked(profile.data.sealed_wallets, key) : null;
  const rawP2p = key && profile.data?.sealed_p2p_notes ? openPacked(profile.data.sealed_p2p_notes, key) : null;
  const rawDetails = key && profile.data?.sealed_txn_details ? openPacked(profile.data.sealed_txn_details, key) : null;
  const rawOrders = key && profile.data?.sealed_order_notes ? openPacked(profile.data.sealed_order_notes, key) : null;
  if (profile.data)
    stale.profile(profile.data, {
      sealed_category_rules: rawRules,
      sealed_manual_items: rawManual,
      sealed_home_values: rawHomes,
      sealed_wallets: rawWallets,
      sealed_p2p_notes: rawP2p,
      sealed_txn_details: rawDetails,
      sealed_order_notes: rawOrders,
    });
  // A part that won't open under any key in the ring counts as missing, and its import as unfinished.
  const parts = (imported.data ?? []).map((r) => {
    const opened = key ? openPacked(r.sealed, key) : null;
    if (opened !== null) stale.importPart(r, opened);
    return { importId: r.import_id, part: r.part, opened, createdAt: r.created_at };
  });
  const { imports, abandoned, locked } = assembleImports(parts);
  // Without a key nothing opens, so nothing can be told apart from abandoned: nothing is removed.
  if (key) for (const id of abandoned) stale.abandonedImport(id);
  return {
    firstName: profile.data?.first_name ?? null,
    timeZone: profile.data?.time_zone ?? null,
    plan: { budgets: validBudgets(profile.data?.plan_budgets ?? undefined), goals: validGoals(profile.data?.plan_goals ?? undefined) },
    categories: rawRules === null ? NO_RULES : validCategoryRules(rawRules),
    manual: rawManual === null ? [] : validManualItems(rawManual),
    homeValues: rawHomes === null ? [] : validHomeValues(rawHomes),
    wallets: rawWallets === null ? [] : validWallets(rawWallets),
    p2pNotes: rawP2p === null ? NO_P2P_NOTES : validP2pNotes(rawP2p),
    orderNotes: rawOrders === null ? NO_ORDER_NOTES : validOrderNotes(rawOrders),
    details: rawDetails === null ? NO_DETAILS : validDetails(rawDetails),
    imports,
    // Without a key nothing opens, so none is known to be locked for good: none is offered for removal.
    lockedImports: key ? locked : [],
    items,
    plaidSync,
    coinbase: coinbaseRecord,
    coinbaseShared: sharesCoinbase ? { balance: value?.balance ?? null, at: value ? (coinbase.data?.snapshot_at ?? null) : null } : null,
    feedUpdatedAt: feed.data?.updated_at ?? null,
    inHousehold: (household.data?.length ?? 0) > 0,
    alerts: {
      ...alertSettings(profile.data),
      takenAt: alertSnapshot.data?.updated_at ?? null,
      // Not resealed in place: the next visit takes a new one, under the current key.
      stale: key !== null && !!alertSnapshot.data && needsReseal(alertSnapshot.data.sealed, key),
    },
    reseal: stale.run(),
  };
}

/**
 * Replacing the vault key without a privileged sweep: the app has no key that
 * reads anyone else's rows, so each account's seals move to the new key when
 * its owner next uses Prism. Each write lands only over the exact copy it
 * replaces, and never moves a version, so it can't undo or block a save made
 * meanwhile (a Coinbase refresh most of all: its old refresh token is spent).
 * Best effort: a row that isn't moved now is moved next visit.
 */
function staleSeals(account: Account, key: VaultKey | null) {
  const jobs: (() => PromiseLike<{ error: unknown }>)[] = [];
  const db = account.supabase;
  const due = (sealed: string | null | undefined): boolean => key !== null && needsReseal(sealed, key);
  return {
    plaidToken(r: PlaidRow, opened: unknown) {
      if (!due(r.sealed_token)) return;
      const { item_id, sealed_token: was } = r;
      const sealed_token = sealJson(opened, key!);
      jobs.push(() => db.from("plaid_items").update({ sealed_token }).eq("user_id", account.userId).eq("item_id", item_id).eq("sealed_token", was));
    },
    /** Keyed on the sync version, not the copy: a copy can be megabytes, and only a new sync (which moves the version) changes it. */
    plaidSync(r: PlaidRow, raw: unknown) {
      if (!due(r.sealed_sync)) return;
      const k = key!;
      const { item_id, sync_version } = r;
      jobs.push(() =>
        db
          .from("plaid_items")
          .update({ sealed_sync: sealPacked(raw, k) })
          .eq("user_id", account.userId)
          .eq("item_id", item_id)
          .eq("sync_version", sync_version ?? 0),
      );
    },
    coinbase(row: CoinbaseRow, record: CoinbaseRecord) {
      if (!due(row.sealed_tokens)) return;
      const { version, sealed_tokens: was } = row;
      const sealed_tokens = sealJson(record.tokens, key!);
      jobs.push(() => db.from("coinbase_links").update({ sealed_tokens }).eq("user_id", account.userId).eq("version", version).eq("sealed_tokens", was));
    },
    /** The value a household is shown, guarded by when it was taken: a newer copy is never replaced by this one. */
    coinbaseValue(row: CoinbaseRow, opened: unknown) {
      if (!due(row.sealed_snapshot) || !row.snapshot_at) return;
      const sealed_snapshot = sealPacked(opened, key!);
      const was = row.snapshot_at;
      jobs.push(() => db.from("coinbase_links").update({ sealed_snapshot }).eq("user_id", account.userId).eq("snapshot_at", was));
    },
    /**
     * The profile's sealed columns, in ONE write guarded by the profile's
     * updated_at (touched by every write to it), since the sealed values are
     * too big to send as a filter. One write, because a second guarded by
     * the same updated_at would always find it moved by the first.
     */
    profile(
      row: ProfileRow,
      opened: Pick<Record<keyof ProfileRow, unknown>, "sealed_category_rules" | "sealed_manual_items" | "sealed_home_values" | "sealed_wallets" | "sealed_p2p_notes" | "sealed_txn_details" | "sealed_order_notes">,
    ) {
      const k = key!;
      const patch: Record<string, string> = {};
      for (const column of ["sealed_category_rules", "sealed_manual_items", "sealed_home_values", "sealed_wallets", "sealed_p2p_notes", "sealed_txn_details", "sealed_order_notes"] as const) {
        if (opened[column] !== null && due(row[column])) patch[column] = sealPacked(opened[column], k);
      }
      if (Object.keys(patch).length === 0) return;
      const was = row.updated_at;
      jobs.push(() => db.from("profiles").update(patch).eq("user_id", account.userId).eq("updated_at", was));
    },
    /** A stored part of an import: written once and never changed, so its key alone guards the write. */
    importPart(row: ImportPartRow, opened: unknown) {
      if (!due(row.sealed)) return;
      const sealed = sealPacked(opened, key!);
      jobs.push(() => db.from("imported_history").update({ sealed }).eq("user_id", account.userId).eq("import_id", row.import_id).eq("part", row.part));
    },
    /** An import left unfinished for over a day (a tab closed mid-way): nothing will ever complete it. */
    abandonedImport(importId: string) {
      jobs.push(() => db.from("imported_history").delete().eq("user_id", account.userId).eq("import_id", importId));
    },
    /** The feed's secret, and its bill list with it: both were sealed by the key being replaced. */
    feed(row: FeedRow) {
      if (!due(row.sealed_token)) return;
      const k = key!;
      const was = row.sealed_token;
      const opened = openJson(was, k) as { token?: unknown } | null;
      if (typeof opened?.token !== "string") return;
      jobs.push(async () => {
        const { data } = await db.from("calendar_feeds").select("snapshot").eq("user_id", account.userId).maybeSingle<{ snapshot: unknown }>();
        const snapshot = openFeedSnapshot(data?.snapshot, k);
        return db
          .from("calendar_feeds")
          .update({ sealed_token: sealJson(opened, k), ...(snapshot === null ? {} : { snapshot: sealFeedSnapshot(snapshot, k) }) })
          .eq("user_id", account.userId)
          .eq("sealed_token", was);
      });
    },
    run(): (() => Promise<void>) | null {
      if (jobs.length === 0) return null;
      return async () => {
        const results = await Promise.allSettled(jobs.map((job) => job()));
        const failed = results.filter((r) => r.status === "rejected" || r.value.error).length;
        // How many, never what: the rows hold bank data.
        if (failed > 0) console.warn(`Prism: ${failed} of ${jobs.length} sealed values stay under an older vault key until the next visit.`);
      };
    },
  };
}

/** Their alert email choices as stored: off, every kind, with amounts, until they say otherwise. */
function alertSettings(row: Pick<ProfileRow, "alert_email" | "alert_kinds" | "alert_amounts" | "alert_refresh"> | null): AlertSettings {
  const kinds = Array.isArray(row?.alert_kinds) ? row.alert_kinds.filter(isAlertChoice) : [...ALERT_CHOICES];
  return { on: row?.alert_email === true, kinds, amounts: row?.alert_amounts !== false, refresh: row?.alert_refresh !== false };
}

async function upsertProfile(account: Account, patch: Record<string, unknown>): Promise<void> {
  const { error } = await account.supabase.from("profiles").upsert({ user_id: account.userId, ...patch }, { onConflict: "user_id" });
  if (error) throw new Error(`Couldn't save to your account: ${error.message}`);
}

/** The first name Prism greets them by — already read by `readFirstName`. Null goes without one. */
export function saveAccountFirstName(account: Account, firstName: string | null) {
  return upsertProfile(account, { first_name: firstName });
}

/** The IANA zone the person's browser reports — already checked by `validZone`. */
export function saveAccountTimeZone(account: Account, timeZone: string) {
  return upsertProfile(account, { time_zone: timeZone });
}

export function saveAccountBudgets(account: Account, budgets: Budget[] | null) {
  return upsertProfile(account, { plan_budgets: budgets });
}

export function saveAccountGoals(account: Account, goals: GoalSettings[] | null) {
  return upsertProfile(account, { plan_goals: goals });
}

/**
 * The category fixes as stored now, read strictly: a failed read throws
 * rather than passing for "no fixes", so a save can never write over fixes it
 * couldn't see. Fixes no key in the ring opens are gone either way.
 */
export async function loadAccountCategoryRules(account: Account, key: VaultKey): Promise<CategoryRules> {
  const { data, error } = await account.supabase.from("profiles").select("sealed_category_rules").eq("user_id", account.userId).maybeSingle<Pick<ProfileRow, "sealed_category_rules">>();
  if (error) throw new Error("Couldn't read your category fixes.");
  return data?.sealed_category_rules ? validCategoryRules(openPacked(data.sealed_category_rules, key)) : NO_RULES;
}

/** Sealed like the transactions they rename: merchant names are bank data. Null when there are none left. */
export function saveAccountCategoryRules(account: Account, rules: CategoryRules, key: VaultKey) {
  return upsertProfile(account, { sealed_category_rules: hasRules(rules) ? sealPacked(rules, key) : null });
}

/** Their payment notes, read strictly before a save, like category fixes: a failed read never passes for "none". */
export async function loadAccountP2pNotes(account: Account, key: VaultKey): Promise<P2pNotes> {
  const { data, error } = await account.supabase.from("profiles").select("sealed_p2p_notes").eq("user_id", account.userId).maybeSingle<Pick<ProfileRow, "sealed_p2p_notes">>();
  if (error) throw new Error("Couldn't read your payment notes.");
  return data?.sealed_p2p_notes ? validP2pNotes(openPacked(data.sealed_p2p_notes, key)) : NO_P2P_NOTES;
}

/** Sealed: other people's names and notes about the person's money. Null when there are none left. */
export function saveAccountP2pNotes(account: Account, notes: P2pNotes, key: VaultKey) {
  return upsertProfile(account, { sealed_p2p_notes: Object.keys(notes.notes).length ? sealPacked(notes, key) : null });
}

/** What their Amazon charges paid for, read strictly before a save: a failed read never passes for "none". */
export async function loadAccountOrderNotes(account: Account, key: VaultKey): Promise<OrderNotes> {
  const { data, error } = await account.supabase.from("profiles").select("sealed_order_notes").eq("user_id", account.userId).maybeSingle<Pick<ProfileRow, "sealed_order_notes">>();
  if (error) throw new Error("Couldn't read your Amazon orders.");
  return data?.sealed_order_notes ? validOrderNotes(openPacked(data.sealed_order_notes, key)) : NO_ORDER_NOTES;
}

/** The longest sealed value the column takes (its check allows 2,000,000): past it, the oldest orders give way. */
const ORDER_SEALED_MAX = 1_950_000;

/** Sealed: sellers' names for what the person bought. The oldest orders go first if it won't fit; null when there are none left. */
export async function saveAccountOrderNotes(account: Account, notes: OrderNotes, key: VaultKey): Promise<void> {
  let kept = Object.entries(notes.notes).sort((a, b) => (a[1].date < b[1].date ? 1 : a[1].date > b[1].date ? -1 : 0));
  let sealed = kept.length ? sealPacked({ v: 1, notes: Object.fromEntries(kept) }, key) : null;
  while (sealed !== null && sealed.length > ORDER_SEALED_MAX) {
    kept = kept.slice(0, Math.floor(kept.length * 0.8));
    sealed = kept.length ? sealPacked({ v: 1, notes: Object.fromEntries(kept) }, key) : null;
  }
  await upsertProfile(account, { sealed_order_notes: sealed });
}

/** Their splits, tags and who owes them, read strictly before a save: a failed read never passes for "none". */
export async function loadAccountDetails(account: Account, key: VaultKey): Promise<TxnDetails> {
  const { data, error } = await account.supabase.from("profiles").select("sealed_txn_details").eq("user_id", account.userId).maybeSingle<Pick<ProfileRow, "sealed_txn_details">>();
  if (error) throw new Error("Couldn't read your transaction details.");
  return data?.sealed_txn_details ? validDetails(openPacked(data.sealed_txn_details, key)) : NO_DETAILS;
}

/** Sealed: the person's own words about their money, and other people's names. Null only when no line AND no shop's split is left. */
export function saveAccountDetails(account: Account, details: TxnDetails, key: VaultKey) {
  return upsertProfile(account, { sealed_txn_details: hasDetails(details) ? sealPacked(details, key) : null });
}

/** What they own or owe, read strictly before a save, like category fixes: a failed read never passes for "nothing". */
export async function loadAccountManualItems(account: Account, key: VaultKey): Promise<ManualItem[]> {
  const { data, error } = await account.supabase.from("profiles").select("sealed_manual_items").eq("user_id", account.userId).maybeSingle<Pick<ProfileRow, "sealed_manual_items">>();
  if (error) throw new Error("Couldn't read what you've added.");
  return data?.sealed_manual_items ? validManualItems(openPacked(data.sealed_manual_items, key)) : [];
}

/** Sealed: what someone owns and what it's worth is financial data. Null when nothing is left. */
export function saveAccountManualItems(account: Account, items: ManualItem[], key: VaultKey) {
  return upsertProfile(account, { sealed_manual_items: items.length ? sealPacked(items, key) : null });
}

/** Read strictly before a save, like the items: a failed read is an error, never "no homes" to write over. */
export async function loadAccountHomeValues(account: Account, key: VaultKey): Promise<HomeValuation[]> {
  const { data, error } = await account.supabase.from("profiles").select("sealed_home_values").eq("user_id", account.userId).maybeSingle<Pick<ProfileRow, "sealed_home_values">>();
  if (error) throw new Error("Couldn't read your homes' addresses.");
  return data?.sealed_home_values ? validHomeValues(openPacked(data.sealed_home_values, key)) : [];
}

/**
 * What someone owns and where their homes are, in one write, so an item and
 * its address never disagree. Sealed: where someone lives. The addresses keep
 * a column of their own, so they never travel with what a person shares.
 */
export function saveAccountManualItemsAndHomes(account: Account, items: ManualItem[], homes: HomeValuation[], key: VaultKey) {
  // A home's address goes with the home: none is kept for an item that isn't there, or isn't a home.
  const kept = homes.filter((h) => items.some((i) => i.id === h.itemId && i.kind === "home"));
  return upsertProfile(account, {
    sealed_manual_items: items.length ? sealPacked(items, key) : null,
    sealed_home_values: kept.length ? sealPacked(storedHomeValues(kept), key) : null,
  });
}

/** Alert email choices, already checked by `saveAlertEmails`; off alone keeps the rest. Turning them off deletes the job's snapshot too (a trigger). */
export function saveAlertSettings(account: Account, settings: AlertSettings | { on: false }) {
  return upsertProfile(
    account,
    "kinds" in settings ? { alert_email: settings.on, alert_kinds: settings.kinds, alert_amounts: settings.amounts, alert_refresh: settings.refresh } : { alert_email: false },
  );
}

/**
 * What this visit found, for the alert email job, sealed. The database keeps
 * it only while the person's emails are on, so a write that lands after
 * they turned them off is refused, and that's fine.
 */
export async function saveAlertSnapshot(account: Account, snapshot: AlertSnapshot, key: VaultKey): Promise<void> {
  const { error } = await account.supabase.from("alert_snapshots").upsert({ user_id: account.userId, sealed: sealPacked(snapshot, key) }, { onConflict: "user_id" });
  if (error) throw new Error(`Couldn't keep the alert snapshot: ${error.message}`);
}

/** Nothing of theirs is live any more (the last bank removed): the job gets no figures from an old visit. */
export async function forgetAlertSnapshot(account: Account): Promise<void> {
  await account.supabase.from("alert_snapshots").delete().eq("user_id", account.userId);
}

export async function addAccountPlaidItem(account: Account, item: VaultItem, key: VaultKey): Promise<void> {
  const { error } = await account.supabase.from("plaid_items").upsert(
    {
      user_id: account.userId,
      item_id: item.itemId,
      sealed_token: sealJson({ accessToken: item.accessToken }, key),
      institution_id: item.institutionId,
      institution_name: item.institutionName,
      linked_at: item.linkedAt,
    },
    { onConflict: "user_id,item_id" },
  );
  if (error) throw new Error(`Couldn't save the bank link: ${error.message}`);
}

/**
 * Keep a bank's new sync — only over the version it started from. If another
 * tab saved first, its copy is as new as this one or newer, and this one is
 * dropped. `startedAt` is when the sync began, so news Plaid announced while
 * it ran still reads as news next time. True when this copy landed.
 */
/** Under the column's own limit, with room to spare; a copy bigger than this isn't kept (the next visit syncs again). */
export const SEALED_SYNC_MAX = 15_000_000;

export async function saveAccountPlaidSync(account: Account, itemId: string, state: SyncState, key: VaultKey, fromVersion: number, startedAt: string): Promise<boolean> {
  const sealed = sealPacked(state, key);
  if (sealed.length > SEALED_SYNC_MAX) throw new Error(`A bank's sync is too large to keep (${sealed.length} characters).`);
  const { data, error } = await account.supabase
    .from("plaid_items")
    .update({ sealed_sync: sealed, sync_version: fromVersion + 1, synced_at: startedAt })
    .eq("user_id", account.userId)
    .eq("item_id", itemId)
    .eq("sync_version", fromVersion)
    .select("item_id");
  if (error) throw new Error(`Couldn't save the bank's sync: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** A bank's warning as stored: one the database would accept, or none. */
export function bankAttention(r: Pick<PlaidRow, "attention" | "disconnect_at">): BankAttention | null {
  if (r.attention === "sign-in" || r.attention === "revoked") return { state: r.attention, disconnectAt: null };
  if (r.attention === "disconnecting" && r.disconnect_at && Number.isFinite(Date.parse(r.disconnect_at))) return { state: "disconnecting", disconnectAt: r.disconnect_at };
  return null;
}

/**
 * A bank's warning is over: it synced (so it isn't waiting on a sign-in and
 * hasn't been withdrawn), or its owner finished signing in again (which also
 * renews a consent that was ending). `only` limits it to those states, so a
 * mere sync never clears a consent that's still running out; `news` marks the
 * bank as changed so the next visit reads it afresh (after a sign-in).
 */
export async function clearBankAttention(account: Account, itemId: string, { only, news = false }: { only?: BankAttention["state"][]; news?: boolean } = {}): Promise<void> {
  const cleared = { attention: null, attention_at: null, disconnect_at: null };
  let q = account.supabase
    .from("plaid_items")
    .update(news ? { ...cleared, changed_at: new Date().toISOString() } : cleared)
    .eq("user_id", account.userId)
    .eq("item_id", itemId);
  q = only ? q.in("attention", only) : q.not("attention", "is", null);
  const { error } = await q;
  if (error) throw new Error(`Couldn't clear the bank's warning: ${error.message}`);
}

export async function removeAccountPlaidItem(account: Account, itemId: string): Promise<void> {
  await account.supabase.from("plaid_items").delete().eq("user_id", account.userId).eq("item_id", itemId);
}

export async function saveAccountCoinbase(account: Account, tokens: TokenSet, key: VaultKey): Promise<void> {
  const { error } = await account.supabase.from("coinbase_links").upsert(
    { user_id: account.userId, sealed_tokens: sealJson(tokens, key), expires_at: new Date(tokens.expiresAt).toISOString(), version: 1, linked_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`Couldn't save the Coinbase link: ${error.message}`);
}

/**
 * Keep the household's copy of Coinbase's value current: its total, sealed,
 * as of now. The database keeps it only while Coinbase is shared (a trigger
 * blanks it otherwise), and only the owner's own visits write it.
 */
export async function saveCoinbaseValue(account: Account, balance: number, key: VaultKey): Promise<void> {
  const { error } = await account.supabase
    .from("coinbase_links")
    .update({ sealed_snapshot: sealPacked({ v: 1, balance }, key), snapshot_at: new Date().toISOString() })
    .eq("user_id", account.userId);
  if (error) throw new Error(`Couldn't keep the household's Coinbase value: ${error.message}`);
}

export async function removeAccountCoinbase(account: Account): Promise<void> {
  await account.supabase.from("coinbase_links").delete().eq("user_id", account.userId);
}

/**
 * A live Coinbase token for this account, refreshing it first if it's close
 * to lapsing. The refresh lands only if nobody else refreshed since we read
 * (version check); if another request won the race, its fresh pair is read
 * back and used instead. Null when the link is dead.
 */
export async function liveCoinbaseToken(
  account: Account,
  record: CoinbaseRecord,
  config: CoinbaseConfig,
  key: VaultKey,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<string | null> {
  if (!needsRefresh(record.tokens, now)) return record.tokens.accessToken;
  let next: TokenSet;
  try {
    next = await refreshTokens(config, record.tokens.refreshToken, fetchImpl, now);
  } catch {
    const again = await account.supabase
      .from("coinbase_links")
      .select("sealed_tokens, expires_at, version, linked_at")
      .eq("user_id", account.userId)
      .maybeSingle<CoinbaseRow>();
    const fresh = openCoinbase(again.data ?? null, key);
    return fresh && fresh.version !== record.version && !needsRefresh(fresh.tokens, now) ? fresh.tokens.accessToken : null;
  }
  await account.supabase
    .from("coinbase_links")
    .update({ sealed_tokens: sealJson(next, key), expires_at: new Date(next.expiresAt).toISOString(), version: record.version + 1 })
    .eq("user_id", account.userId)
    .eq("version", record.version);
  return next.accessToken;
}

// ── The self-updating calendar ───────────────────────────────────────────────

/** This account's secret calendar URL token, creating one (or a new one, on reset) if asked. */
export async function accountFeedToken(account: Account, key: VaultKey, opts: { create: boolean; reset?: boolean }): Promise<string | null> {
  if (!opts.reset) {
    const { data } = await account.supabase.from("calendar_feeds").select("sealed_token").eq("user_id", account.userId).maybeSingle<{ sealed_token: string }>();
    const existing = data ? (openJson(data.sealed_token, key) as { token?: unknown } | null) : null;
    if (typeof existing?.token === "string") return existing.token;
    if (!opts.create) return null;
  }
  const token = randomBytes(32).toString("base64url");
  const { error } = await account.supabase
    .from("calendar_feeds")
    .upsert({ user_id: account.userId, token_hash: feedTokenHash(token), sealed_token: sealJson({ token }, key) }, { onConflict: "user_id" });
  if (error) throw new Error(`Couldn't create your calendar link: ${error.message}`);
  return token;
}

/** Stored sealed: bank-derived bills never sit readable in the database. */
export async function saveFeedSnapshot(account: Account, snapshot: unknown, key: VaultKey): Promise<void> {
  await account.supabase.from("calendar_feeds").update({ snapshot: sealFeedSnapshot(snapshot, key) }).eq("user_id", account.userId);
}

export async function removeAccountFeed(account: Account): Promise<void> {
  await account.supabase.from("calendar_feeds").delete().eq("user_id", account.userId);
}

/** Read strictly before a change, like the items: a failed read is an error, never "no wallets" to write over. */
export async function loadAccountWallets(account: Account, key: VaultKey): Promise<Wallet[]> {
  const { data, error } = await account.supabase.from("profiles").select("sealed_wallets").eq("user_id", account.userId).maybeSingle<Pick<ProfileRow, "sealed_wallets">>();
  if (error) throw new Error("Couldn't read your wallets.");
  return data?.sealed_wallets ? validWallets(openPacked(data.sealed_wallets, key)) : [];
}

/** Sealed: an address shows everything it has ever held. Null when there are none. */
export function saveAccountWallets(account: Account, wallets: Wallet[], key: VaultKey) {
  return upsertProfile(account, { sealed_wallets: wallets.length ? sealPacked(storedWallets(wallets), key) : null });
}

/**
 * New readings, kept only for wallets still there at the same address, and
 * written only over the profile as it was read: a wallet added or removed
 * meanwhile is never undone for a cached balance. A whole wallet's scripts,
 * as its history showed them, go with its reading. True when written.
 */
export async function saveWalletReadings(account: Account, readings: Map<string, { address: string; reading: Reading; scripts?: Script[] }>, key: VaultKey): Promise<boolean> {
  const db = account.supabase;
  const { data, error } = await db.from("profiles").select("sealed_wallets, updated_at").eq("user_id", account.userId).maybeSingle<Pick<ProfileRow, "sealed_wallets" | "updated_at">>();
  if (error || !data?.sealed_wallets) return false;
  const wallets = validWallets(openPacked(data.sealed_wallets, key));
  let changed = false;
  const next = wallets.map((w) => {
    const r = readings.get(w.id);
    if (!r || r.address !== w.address) return w;
    changed = true;
    return r.scripts && w.scripts ? { ...w, reading: r.reading, scripts: r.scripts } : { ...w, reading: r.reading };
  });
  if (!changed) return false;
  const { error: failed, count } = await db
    .from("profiles")
    .update({ sealed_wallets: sealPacked(storedWallets(next), key) }, { count: "exact" })
    .eq("user_id", account.userId)
    .eq("updated_at", data.updated_at);
  return !failed && count === 1;
}

/**
 * Claims whole wallets for reading: marks each still-stale one `tried` now,
 * in one write guarded like the readings, and returns the ids it marked.
 * Whoever loses the race gets none, so a wallet is read by one request at a
 * time, and one that failed isn't asked about again until it's due.
 */
export async function claimWalletScans(account: Account, ids: string[], key: VaultKey, now = Date.now()): Promise<string[]> {
  const db = account.supabase;
  const { data, error } = await db.from("profiles").select("sealed_wallets, updated_at").eq("user_id", account.userId).maybeSingle<Pick<ProfileRow, "sealed_wallets" | "updated_at">>();
  if (error || !data?.sealed_wallets) return [];
  const wanted = new Set(ids);
  const claimed: string[] = [];
  const tried = new Date(now).toISOString();
  const next = validWallets(openPacked(data.sealed_wallets, key)).map((w) => {
    if (!wanted.has(w.id) || !w.scripts || !walletStale(w, now)) return w;
    claimed.push(w.id);
    return { ...w, tried };
  });
  if (claimed.length === 0) return [];
  const { error: failed, count } = await db
    .from("profiles")
    .update({ sealed_wallets: sealPacked(storedWallets(next), key) }, { count: "exact" })
    .eq("user_id", account.userId)
    .eq("updated_at", data.updated_at);
  return !failed && count === 1 ? claimed : [];
}
