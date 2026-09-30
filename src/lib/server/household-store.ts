// src/lib/server/household-store.ts
//
// A household, read and written AS the signed-in person, only through the
// database's own household functions and policies
// (supabase/migrations/20260930000000_households.sql). Nothing here can read
// another member's rows directly: their shared money arrives from
// household_shared_money() as sealed copies, never a token, and is opened
// and narrowed to what they shared in finance/household.ts.

import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { validBudgets, validGoals, type GoalSettings } from "@/lib/finance/plan";
import type { Budget } from "@/lib/finance/types";
import type { Account } from "@/lib/supabase/server";

export const HOUSEHOLD_MAX = 4;

export type HouseholdPerson = { userId: string; firstName: string | null; email: string; joinedAt: string; me: boolean };
export type HouseholdInvite = { id: string; email: string; expiresAt: string };
export type Household = { people: HouseholdPerson[]; invites: HouseholdInvite[] };

/** One other member's shared money, still sealed. */
export type SharedMoneyRow = {
  userId: string;
  firstName: string | null;
  sharedAccountIds: string[];
  sealedCategoryRules: string | null;
  sealedManualItems: string | null;
  items: { itemId: string; institutionName: string | null; sealedSync: string | null; syncedAt: string | null }[];
  /** Their shared Coinbase's value, sealed, as of their last visit; null when not shared or not copied yet. */
  coinbase: { sealed: string | null; at: string | null } | null;
};

export type InviteStatus = "ok" | "not_found" | "wrong_email" | "expired" | "already_member" | "in_another" | "full";

/** An invitation's secret travels only in the link; the database keeps its sha256. */
export function inviteHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The caller's household, or null when they're in none. Throws when it can't tell. */
export async function loadHousehold(account: Account): Promise<Household | null> {
  const db = account.supabase;
  const [people, invites] = await Promise.all([
    db.rpc("household_people"),
    db.from("household_invites").select("id, email, expires_at").order("created_at").returns<{ id: string; email: string; expires_at: string }[]>(),
  ]);
  if (people.error || invites.error) throw new Error("Couldn't read your household.");
  const rows = (people.data ?? []) as { user_id: string; first_name: string | null; email: string; joined_at: string; is_me: boolean }[];
  if (!rows.length) return null;
  const now = Date.now();
  const live = (invites.data ?? []).filter((i) => Date.parse(i.expires_at) > now);
  // An invitation that ran out can't be used or shown, so the address it went to isn't kept either.
  const expired = (invites.data ?? []).filter((i) => !live.includes(i)).map((i) => i.id);
  if (expired.length) await db.from("household_invites").delete().in("id", expired).then(undefined, () => undefined);
  return {
    people: rows.map((p) => ({ userId: p.user_id, firstName: p.first_name, email: p.email, joinedAt: p.joined_at, me: p.is_me })),
    invites: live.map((i) => ({ id: i.id, email: i.email, expiresAt: i.expires_at })),
  };
}

/** A new invitation for `email`; the secret for its link, which only the inviter ever sees. */
export async function createInvite(account: Account, email: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const { error } = await account.supabase.rpc("create_household_invite", { p_email: email, p_token_hash: inviteHash(token) });
  if (error) throw new HouseholdError(error.code === "23514" ? "full" : error.code === "22023" ? "self" : error.code === "23505" ? "member" : "failed");
  return token;
}

export async function inviteStatus(account: Account, token: string): Promise<{ status: InviteStatus; invitedBy: string | null }> {
  const { data, error } = await account.supabase.rpc("household_invite_status", { p_token_hash: inviteHash(token) });
  const row = ((data ?? []) as { status: InviteStatus; invited_by_name: string | null }[])[0];
  if (error || !row) throw new HouseholdError("failed");
  return { status: row.status, invitedBy: row.invited_by_name };
}

export async function acceptInvite(account: Account, token: string): Promise<void> {
  const { error } = await account.supabase.rpc("accept_household_invite", { p_token_hash: inviteHash(token) });
  if (error) throw new HouseholdError("failed");
}

export async function declineInvite(account: Account, token: string): Promise<void> {
  const { error } = await account.supabase.rpc("decline_household_invite", { p_token_hash: inviteHash(token) });
  if (error) throw new HouseholdError("failed");
}

export async function cancelInvite(account: Account, id: string): Promise<void> {
  const { error } = await account.supabase.from("household_invites").delete().eq("id", id);
  if (error) throw new HouseholdError("failed");
}

export async function leaveHousehold(account: Account): Promise<void> {
  const { error } = await account.supabase.rpc("leave_household");
  if (error) throw new HouseholdError("failed");
}

/** What this person shares: account id → its bank connection (null for something added by hand). */
export async function loadShares(account: Account): Promise<Map<string, string | null>> {
  const { data, error } = await account.supabase.from("shared_accounts").select("account_id, item_id").eq("user_id", account.userId).returns<{ account_id: string; item_id: string | null }[]>();
  if (error) throw new HouseholdError("failed");
  return new Map((data ?? []).map((r) => [r.account_id, r.item_id]));
}

export async function setShare(account: Account, accountId: string, itemId: string | null, shared: boolean): Promise<void> {
  const db = account.supabase;
  const { error } = shared
    ? await db.from("shared_accounts").upsert({ user_id: account.userId, account_id: accountId, item_id: itemId }, { onConflict: "user_id,account_id" })
    : await db.from("shared_accounts").delete().eq("user_id", account.userId).eq("account_id", accountId);
  if (error) throw new HouseholdError("failed");
}

/** The other members' shared money, sealed. */
export async function loadSharedMoney(account: Account): Promise<SharedMoneyRow[]> {
  const { data, error } = await account.supabase.rpc("household_shared_money");
  if (error) throw new HouseholdError("failed");
  const rows = (data ?? []) as {
    user_id: string;
    first_name: string | null;
    shared_account_ids: string[] | null;
    sealed_category_rules: string | null;
    sealed_manual_items: string | null;
    items: { item_id: string; institution_name: string | null; sealed_sync: string | null; synced_at: string | null }[] | null;
    coinbase: { sealed: string | null; at: string | null } | null;
  }[];
  return rows.map((r) => ({
    userId: r.user_id,
    firstName: r.first_name,
    sharedAccountIds: r.shared_account_ids ?? [],
    sealedCategoryRules: r.sealed_category_rules,
    sealedManualItems: r.sealed_manual_items,
    items: (r.items ?? []).map((i) => ({ itemId: i.item_id, institutionName: i.institution_name, sealedSync: i.sealed_sync, syncedAt: i.synced_at })),
    coinbase: r.coinbase ? { sealed: r.coinbase.sealed ?? null, at: r.coinbase.at ?? null } : null,
  }));
}

/** Who last changed one of the household's lists, and when; `by` is null once their account is gone. */
export type PlanChange = { by: string | null; at: string };

/**
 * The household's budgets and goals, checked all-or-nothing like a person's
 * own (null: never edited, or not a plan any more), each with the version a
 * save must name and who changed it last.
 */
export type HouseholdPlan = {
  budgets: Budget[] | null;
  goals: GoalSettings[] | null;
  budgetsVersion: number;
  goalsVersion: number;
  budgetsChanged: PlanChange | null;
  goalsChanged: PlanChange | null;
};

/** The caller's household plan; null when they're in no household. Throws when it can't tell. */
export async function loadHouseholdPlan(account: Account): Promise<HouseholdPlan | null> {
  const { data, error } = await account.supabase.rpc("household_plan");
  if (error) throw new HouseholdError("failed");
  const row = ((data ?? []) as {
    budgets: unknown;
    goals: unknown;
    budgets_version: number;
    goals_version: number;
    budgets_changed_by_name: string | null;
    budgets_changed_at: string | null;
    goals_changed_by_name: string | null;
    goals_changed_at: string | null;
  }[])[0];
  if (!row) return null;
  return {
    budgets: validBudgets(row.budgets ?? undefined),
    goals: validGoals(row.goals ?? undefined),
    budgetsVersion: row.budgets_version,
    goalsVersion: row.goals_version,
    budgetsChanged: row.budgets_changed_at ? { by: row.budgets_changed_by_name, at: row.budgets_changed_at } : null,
    goalsChanged: row.goals_changed_at ? { by: row.goals_changed_by_name, at: row.goals_changed_at } : null,
  };
}

function planError(code: string | undefined): HouseholdError {
  return new HouseholdError(code === "40001" ? "stale" : code === "42501" ? "outside" : "failed");
}

/** Replace the household's budgets (null: back to drafted), from `version`. The new version. */
export async function saveHouseholdBudgets(account: Account, budgets: Budget[] | null, version: number): Promise<number> {
  const { data, error } = await account.supabase.rpc("set_household_budgets", { p_budgets: budgets, p_version: version });
  if (error) throw planError(error.code);
  return data as number;
}

export async function saveHouseholdGoals(account: Account, goals: GoalSettings[] | null, version: number): Promise<number> {
  const { data, error } = await account.supabase.rpc("set_household_goals", { p_goals: goals, p_version: version });
  if (error) throw planError(error.code);
  return data as number;
}

/**
 * What went wrong, as the actions put it to the person; never the database's
 * own words. "stale": someone else in the household saved first. "outside":
 * they aren't in a household (any more).
 */
export class HouseholdError extends Error {
  constructor(readonly reason: "full" | "self" | "member" | "stale" | "outside" | "failed") {
    super(reason);
  }
}
