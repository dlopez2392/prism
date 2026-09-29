// src/lib/server/account-store.ts
//
// Everything a signed-in person keeps in their account, read and written AS
// that person (row-level security does the guarding). Tokens are sealed with
// PRISM_VAULT_KEY before they leave this process and opened only here; the
// database only ever holds ciphertext.

import "server-only";
import { randomBytes } from "node:crypto";
import { refreshTokens, type CoinbaseConfig, type TokenSet } from "@/lib/coinbase/client";
import { hasRules, NO_RULES, validCategoryRules, type CategoryRules } from "@/lib/finance/category-rules";
import { validManualItems, type ManualItem } from "@/lib/finance/manual";
import { validBudgets, validGoals, type GoalSettings, type Plan } from "@/lib/finance/plan";
import type { Budget } from "@/lib/finance/types";
import type { Account } from "@/lib/supabase/server";
import { needsRefresh } from "./coinbase-store";
import { feedTokenHash, openFeedSnapshot, sealFeedSnapshot } from "./feed-token";
import { validState, type StoredSync, type SyncState } from "@/lib/plaid/sync";
import { needsReseal, openJson, openPacked, sealJson, sealPacked, type VaultItem, type VaultKey } from "./vault";

type ProfileRow = {
  first_name: string | null;
  plan_budgets: unknown;
  plan_goals: unknown;
  time_zone: string | null;
  sealed_category_rules: string | null;
  sealed_manual_items: string | null;
  updated_at: string;
};
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
};
type CoinbaseRow = { sealed_tokens: string; expires_at: string; version: number; linked_at: string };
type FeedRow = { updated_at: string; sealed_token: string };

export type CoinbaseRecord = { tokens: TokenSet; version: number; linkedAt: string };

export type AccountSources = {
  firstName: string | null;
  timeZone: string | null;
  plan: Plan;
  /** The person's category fixes; none when there are none, or none open under the vault key. */
  categories: CategoryRules;
  /** What they own or owe that no bank reports, added by hand. */
  manual: ManualItem[];
  items: VaultItem[];
  /** Each linked bank's stored sync (cursor, transactions, balances), by item id — empty unless asked for. */
  plaidSync: Map<string, StoredSync>;
  coinbase: CoinbaseRecord | null;
  feedUpdatedAt: string | null;
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
export async function loadAccount(account: Account, key: VaultKey | null, { strict = false, withSync = false } = {}): Promise<AccountSources> {
  const db = account.supabase;
  const [profile, plaid, coinbase, feed] = await Promise.all([
    db.from("profiles").select("first_name, plan_budgets, plan_goals, time_zone, sealed_category_rules, sealed_manual_items, updated_at").eq("user_id", account.userId).maybeSingle<ProfileRow>(),
    db
      .from("plaid_items")
      .select(withSync ? "item_id, sealed_token, institution_id, institution_name, linked_at, sealed_sync, sync_version, synced_at, changed_at" : "item_id, sealed_token, institution_id, institution_name, linked_at")
      .eq("user_id", account.userId)
      .returns<PlaidRow[]>(),
    db.from("coinbase_links").select("sealed_tokens, expires_at, version, linked_at").eq("user_id", account.userId).maybeSingle<CoinbaseRow>(),
    db.from("calendar_feeds").select("updated_at, sealed_token").eq("user_id", account.userId).maybeSingle<FeedRow>(),
  ]);
  if (strict && (profile.error || plaid.error || coinbase.error || feed.error)) throw new Error("Couldn't read the account.");
  const items: VaultItem[] = [];
  const plaidSync = new Map<string, StoredSync>();
  const stale = staleSeals(account, key);
  for (const r of plaid.data ?? []) {
    const opened = key ? (openJson(r.sealed_token, key) as { accessToken?: unknown } | null) : null;
    if (typeof opened?.accessToken !== "string") continue; // sealed under another key: unusable, so unseen
    items.push({ itemId: r.item_id, accessToken: opened.accessToken, institutionId: r.institution_id, institutionName: r.institution_name, linkedAt: r.linked_at });
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
  if (feed.data) stale.feed(feed.data);
  const rawRules = key && profile.data?.sealed_category_rules ? openPacked(profile.data.sealed_category_rules, key) : null;
  const rawManual = key && profile.data?.sealed_manual_items ? openPacked(profile.data.sealed_manual_items, key) : null;
  if (profile.data) stale.profile(profile.data, { sealed_category_rules: rawRules, sealed_manual_items: rawManual });
  return {
    firstName: profile.data?.first_name ?? null,
    timeZone: profile.data?.time_zone ?? null,
    plan: { budgets: validBudgets(profile.data?.plan_budgets ?? undefined), goals: validGoals(profile.data?.plan_goals ?? undefined) },
    categories: rawRules === null ? NO_RULES : validCategoryRules(rawRules),
    manual: rawManual === null ? [] : validManualItems(rawManual),
    items,
    plaidSync,
    coinbase: coinbaseRecord,
    feedUpdatedAt: feed.data?.updated_at ?? null,
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
    /**
     * The profile's sealed columns, in ONE write guarded by the profile's
     * updated_at (touched by every write to it), since the sealed values are
     * too big to send as a filter. One write, because a second guarded by
     * the same updated_at would always find it moved by the first.
     */
    profile(row: ProfileRow, opened: Pick<Record<keyof ProfileRow, unknown>, "sealed_category_rules" | "sealed_manual_items">) {
      const k = key!;
      const patch: Record<string, string> = {};
      for (const column of ["sealed_category_rules", "sealed_manual_items"] as const) {
        if (opened[column] !== null && due(row[column])) patch[column] = sealPacked(opened[column], k);
      }
      if (Object.keys(patch).length === 0) return;
      const was = row.updated_at;
      jobs.push(() => db.from("profiles").update(patch).eq("user_id", account.userId).eq("updated_at", was));
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
const SEALED_SYNC_MAX = 15_000_000;

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
