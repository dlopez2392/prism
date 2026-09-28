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
import { feedTokenHash } from "./feed-token";
import { openJson, sealJson, type VaultItem } from "./vault";

type ProfileRow = { first_name: string | null; plan_budgets: unknown; plan_goals: unknown };
type PlaidRow = { item_id: string; sealed_token: string; institution_id: string | null; institution_name: string | null; linked_at: string };
type CoinbaseRow = { sealed_tokens: string; expires_at: string; version: number; linked_at: string };
type FeedRow = { updated_at: string };

export type CoinbaseRecord = { tokens: TokenSet; version: number; linkedAt: string };

export type AccountSources = {
  firstName: string | null;
  plan: Plan;
  items: VaultItem[];
  coinbase: CoinbaseRecord | null;
  feedUpdatedAt: string | null;
};

function openCoinbase(row: CoinbaseRow | null, key: Buffer | null): CoinbaseRecord | null {
  if (!row || !key) return null;
  const t = openJson(row.sealed_tokens, key) as Partial<TokenSet> | null;
  if (!t || typeof t.accessToken !== "string" || typeof t.refreshToken !== "string" || !Number.isFinite(t.expiresAt)) return null;
  return { tokens: { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt! }, version: row.version, linkedAt: row.linked_at };
}

/** One round of parallel reads: the profile (and plan), linked banks, Coinbase, and the calendar feed's age. */
export async function loadAccount(account: Account, key: Buffer | null): Promise<AccountSources> {
  const db = account.supabase;
  const [profile, plaid, coinbase, feed] = await Promise.all([
    db.from("profiles").select("first_name, plan_budgets, plan_goals").eq("user_id", account.userId).maybeSingle<ProfileRow>(),
    db.from("plaid_items").select("item_id, sealed_token, institution_id, institution_name, linked_at").eq("user_id", account.userId).returns<PlaidRow[]>(),
    db.from("coinbase_links").select("sealed_tokens, expires_at, version, linked_at").eq("user_id", account.userId).maybeSingle<CoinbaseRow>(),
    db.from("calendar_feeds").select("updated_at").eq("user_id", account.userId).maybeSingle<FeedRow>(),
  ]);
  const items: VaultItem[] = [];
  for (const r of plaid.data ?? []) {
    const opened = key ? (openJson(r.sealed_token, key) as { accessToken?: unknown } | null) : null;
    if (typeof opened?.accessToken !== "string") continue; // sealed under another key: unusable, so unseen
    items.push({ itemId: r.item_id, accessToken: opened.accessToken, institutionId: r.institution_id, institutionName: r.institution_name, linkedAt: r.linked_at });
  }
  return {
    firstName: profile.data?.first_name ?? null,
    plan: { budgets: validBudgets(profile.data?.plan_budgets ?? undefined), goals: validGoals(profile.data?.plan_goals ?? undefined) },
    items,
    coinbase: openCoinbase(coinbase.data ?? null, key),
    feedUpdatedAt: feed.data?.updated_at ?? null,
  };
}

async function upsertProfile(account: Account, patch: Record<string, unknown>): Promise<void> {
  const { error } = await account.supabase.from("profiles").upsert({ user_id: account.userId, ...patch }, { onConflict: "user_id" });
  if (error) throw new Error(`Couldn't save to your account: ${error.message}`);
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

export async function saveFeedSnapshot(account: Account, snapshot: unknown): Promise<void> {
  await account.supabase.from("calendar_feeds").update({ snapshot }).eq("user_id", account.userId);
}

export async function removeAccountFeed(account: Account): Promise<void> {
  await account.supabase.from("calendar_feeds").delete().eq("user_id", account.userId);
}
