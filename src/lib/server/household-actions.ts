"use server";

// src/lib/server/household-actions.ts
//
// The Server Actions behind households: invite someone, cancel an
// invitation, join or decline one, leave, share or stop sharing an account,
// and switch between Me and Household. All of them act AS the signed-in
// person, through the database's own household functions and policies; none
// can reach another member's rows. An invitation's secret is made here, shown
// once to the inviter inside their link, and kept in the database only as a
// sha256. The link carries it after "#", so it never reaches a server log.
// Next checks each action's Origin against the host (CSRF).

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { currentAccount } from "@/lib/supabase/server";
import { VIEW_COOKIE } from "./finance";
import {
  acceptInvite,
  cancelInvite,
  createInvite,
  declineInvite,
  HouseholdError,
  inviteStatus,
  leaveHousehold,
  setShare,
  type InviteStatus,
} from "./household-store";
import { requestOrigin } from "./origin";

export type InviteState = { status: "idle" } | { status: "error"; message: string } | { status: "invited"; email: string; link: string };

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function reason(e: unknown): string {
  if (e instanceof HouseholdError && e.reason === "full") return "A household has room for four people. Cancel an invitation, or ask someone to leave, first.";
  if (e instanceof HouseholdError && e.reason === "self") return "That's your own email. Invite someone else.";
  if (e instanceof HouseholdError && e.reason === "member") return "They're already in your household.";
  return "That didn't work. Try again in a moment.";
}

export async function inviteToHousehold(_prev: InviteState, form: FormData): Promise<InviteState> {
  const account = await currentAccount();
  if (!account) return { status: "error", message: "Sign in to invite someone." };
  const raw = form.get("email");
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 320) return { status: "error", message: "Enter their email address, like dana@example.com." };
  try {
    const token = await createInvite(account, email);
    refresh();
    return { status: "invited", email, link: `${await requestOrigin()}/household/join#${token}` };
  } catch (e) {
    return { status: "error", message: reason(e) };
  }
}

export async function cancelHouseholdInvite(id: string): Promise<{ ok: boolean }> {
  const account = await currentAccount();
  if (!account || !UUID.test(id)) return { ok: false };
  try {
    await cancelInvite(account, id);
  } catch {
    return { ok: false };
  }
  refresh();
  return { ok: true };
}

/** What the join page may say about the link it was opened with. */
export async function checkHouseholdInvite(token: string): Promise<{ status: InviteStatus | "signed_out" | "error"; invitedBy: string | null }> {
  const account = await currentAccount();
  if (!account) return { status: "signed_out", invitedBy: null };
  if (!TOKEN.test(token)) return { status: "not_found", invitedBy: null };
  try {
    return await inviteStatus(account, token);
  } catch {
    return { status: "error", invitedBy: null };
  }
}

export async function joinHousehold(token: string): Promise<{ ok: boolean; message?: string }> {
  const account = await currentAccount();
  if (!account) return { ok: false, message: "Sign in to join." };
  if (!TOKEN.test(token)) return { ok: false, message: "That link isn't a Prism invitation." };
  try {
    await acceptInvite(account, token);
  } catch {
    return { ok: false, message: "That invitation can't be used any more. Ask for a new link." };
  }
  return { ok: true };
}

export async function declineHousehold(token: string): Promise<{ ok: boolean }> {
  const account = await currentAccount();
  if (!account || !TOKEN.test(token)) return { ok: false };
  try {
    await declineInvite(account, token);
  } catch {
    return { ok: false };
  }
  return { ok: true };
}

export async function leaveTheHousehold(): Promise<{ ok: boolean }> {
  const account = await currentAccount();
  if (!account) return { ok: false };
  try {
    await leaveHousehold(account);
  } catch {
    return { ok: false };
  }
  (await cookies()).delete(VIEW_COOKIE);
  refresh();
  return { ok: true };
}

/**
 * Share one of the person's own accounts, or stop. A bank account names its
 * connection, which must be one of theirs (their own rows are all they can
 * read); something added by hand has none. Coinbase isn't shareable yet: it
 * loads live, as its owner, and a household never uses anyone's access.
 */
export async function setAccountShared(accountId: string, itemId: string | null, shared: boolean): Promise<{ ok: boolean }> {
  const account = await currentAccount();
  if (!account || typeof accountId !== "string" || accountId.length === 0 || accountId.length > 200) return { ok: false };
  const manual = accountId.startsWith("manual-");
  if (manual !== (itemId === null)) return { ok: false };
  if (!manual) {
    const { data, error } = await account.supabase.from("plaid_items").select("item_id").eq("user_id", account.userId).eq("item_id", itemId!).limit(1);
    if (error || !data?.length) return { ok: false };
  }
  try {
    await setShare(account, accountId, itemId, shared);
  } catch {
    return { ok: false };
  }
  refresh();
  return { ok: true };
}

export async function setHouseholdView(view: "me" | "household"): Promise<void> {
  const jar = await cookies();
  if (view === "household") jar.set(VIEW_COOKIE, "household", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  else jar.delete(VIEW_COOKIE);
}
