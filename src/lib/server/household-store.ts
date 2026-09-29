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
  return {
    people: rows.map((p) => ({ userId: p.user_id, firstName: p.first_name, email: p.email, joinedAt: p.joined_at, me: p.is_me })),
    invites: (invites.data ?? []).filter((i) => Date.parse(i.expires_at) > Date.now()).map((i) => ({ id: i.id, email: i.email, expiresAt: i.expires_at })),
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
  }[];
  return rows.map((r) => ({
    userId: r.user_id,
    firstName: r.first_name,
    sharedAccountIds: r.shared_account_ids ?? [],
    sealedCategoryRules: r.sealed_category_rules,
    sealedManualItems: r.sealed_manual_items,
    items: (r.items ?? []).map((i) => ({ itemId: i.item_id, institutionName: i.institution_name, sealedSync: i.sealed_sync, syncedAt: i.synced_at })),
  }));
}

/** What went wrong, as the actions put it to the person; never the database's own words. */
export class HouseholdError extends Error {
  constructor(readonly reason: "full" | "self" | "member" | "failed") {
    super(reason);
  }
}
