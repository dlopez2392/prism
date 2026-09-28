// src/lib/server/account-store.ts
//
// Everything a signed-in person keeps in their account, read and written AS
// that person (row-level security does the guarding). Tokens are sealed with
// PRISM_VAULT_KEY before they leave this process and opened only here; the
// database only ever holds ciphertext.

import "server-only";
import { randomBytes } from "node:crypto";
import { refreshTokens, type CoinbaseConfig, type TokenSet } from "@/lib/coinbase/client";
import { validBudgets, validGoals, type GoalSettings, type Plan } from "@/lib/finance/plan";
import type { Budget } from "@/lib/finance/types";
import type { Account } from "@/lib/supabase/server";
import { needsRefresh } from "./coinbase-store";
import { feedTokenHash, sealFeedSnapshot } from "./feed-token";
import { validState, type StoredSync, type SyncState } from "@/lib/plaid/sync";
import { openJson, openPacked, sealJson, sealPacked, type VaultItem } from "./vault";

type ProfileRow = { first_name: string | null; plan_budgets: unknown; plan_goals: unknown; time_zone: string | null };
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
type FeedRow = { updated_at: string };

export type CoinbaseRecord = { tokens: TokenSet; version: number; linkedAt: string };

export type AccountSources = {
  firstName: string | null;
  timeZone: string | null;
  plan: Plan;
  items: VaultItem[];
  /** Each linked bank's stored sync (cursor, transactions, balances), by item id — empty unless asked for. */
  plaidSync: Map<string, StoredSync>;
  coinbase: CoinbaseRecord | null;
  feedUpdatedAt: string | null;
};

function openCoinbase(row: CoinbaseRow | null, key: Buffer | null): CoinbaseRecord | null {
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
export async function loadAccount(account: Account, key: Buffer | null, { strict = false, withSync = false } = {}): Promise<AccountSources> {
  const db = account.supabase;
  const [profile, plaid, coinbase, feed] = await Promise.all([
    db.from("profiles").select("first_name, plan_budgets, plan_goals, time_zone").eq("user_id", account.userId).maybeSingle<ProfileRow>(),
    db
      .from("plaid_items")
      .select(withSync ? "item_id, sealed_token, institution_id, institution_name, linked_at, sealed_sync, sync_version, synced_at, changed_at" : "item_id, sealed_token, institution_id, institution_name, linked_at")
      .eq("user_id", account.userId)
      .returns<PlaidRow[]>(),
    db.from("coinbase_links").select("sealed_tokens, expires_at, version, linked_at").eq("user_id", account.userId).maybeSingle<CoinbaseRow>(),
    db.from("calendar_feeds").select("updated_at").eq("user_id", account.userId).maybeSingle<FeedRow>(),
  ]);
  if (strict && (profile.error || plaid.error || coinbase.error || feed.error)) throw new Error("Couldn't read the account.");
  const items: VaultItem[] = [];
  const plaidSync = new Map<string, StoredSync>();
  for (const r of plaid.data ?? []) {
    const opened = key ? (openJson(r.sealed_token, key) as { accessToken?: unknown } | null) : null;
    if (typeof opened?.accessToken !== "string") continue; // sealed under another key: unusable, so unseen
    items.push({ itemId: r.item_id, accessToken: opened.accessToken, institutionId: r.institution_id, institutionName: r.institution_name, linkedAt: r.linked_at });
    if (!withSync) continue;
    // A copy that won't open or doesn't read as one starts over at the next sync.
    const state = key ? validState(openPacked(r.sealed_sync, key)) : null;
    plaidSync.set(r.item_id, { state, version: r.sync_version ?? 0, syncedAt: state ? r.synced_at : null, changedAt: r.changed_at ?? null });
  }
  return {
    firstName: profile.data?.first_name ?? null,
    timeZone: profile.data?.time_zone ?? null,
    plan: { budgets: validBudgets(profile.data?.plan_budgets ?? undefined), goals: validGoals(profile.data?.plan_goals ?? undefined) },
    items,
    plaidSync,
    coinbase: openCoinbase(coinbase.data ?? null, key),
    feedUpdatedAt: feed.data?.updated_at ?? null,
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

export async function addAccountPlaidItem(account: Account, item: VaultItem, key: Buffer): Promise<void> {
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

export async function saveAccountPlaidSync(account: Account, itemId: string, state: SyncState, key: Buffer, fromVersion: number, startedAt: string): Promise<boolean> {
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

export async function saveAccountCoinbase(account: Account, tokens: TokenSet, key: Buffer): Promise<void> {
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
  key: Buffer,
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
export async function accountFeedToken(account: Account, key: Buffer, opts: { create: boolean; reset?: boolean }): Promise<string | null> {
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
export async function saveFeedSnapshot(account: Account, snapshot: unknown, key: Buffer): Promise<void> {
  await account.supabase.from("calendar_feeds").update({ snapshot: sealFeedSnapshot(snapshot, key) }).eq("user_id", account.userId);
}

export async function removeAccountFeed(account: Account): Promise<void> {
  await account.supabase.from("calendar_feeds").delete().eq("user_id", account.userId);
}
