"use server";

// src/lib/server/auth-actions.ts
//
// Sign in with a one-time code by email — no password to leak or forget.
// The same email also carries a link that signs in on the device it's opened
// on (/auth/callback). The form asks for the email and nothing else: the
// first name is asked for after sign-in (see src/lib/profile.ts). Sign out,
// and delete the account for good.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { coinbaseConfig, revokeToken } from "@/lib/coinbase/client";
import { plaidConfig, removeItem } from "@/lib/plaid/client";
import { landingAfterSignIn, NEXT_COOKIE, safeNext } from "@/lib/profile";
import { currentAccount, secondStepPending, supabaseServer, twoStepPath } from "@/lib/supabase/server";
import { liveCoinbaseToken, loadAccount } from "./account-store";
import { requestOrigin } from "./origin";
import { vaultKey, type VaultKey } from "./vault";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/t";

export type SignInState =
  | { step: "email"; email?: string; error?: string }
  | { step: "code"; email: string; error?: string; resent?: boolean };

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@.]{2,}$/;

/**
 * Sign-in that interrupted something — approving a connected app — goes back
 * to it afterwards, whether the code or the email's link finishes the job.
 * Kept in a short-lived cookie rather than the email link, so the link stays
 * one Supabase already allows. A plain sign-in clears any stale one.
 */
async function rememberNext(x: FormDataEntryValue | null): Promise<void> {
  const jar = await cookies();
  const next = safeNext(x);
  if (next) jar.set(NEXT_COOKIE, next, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 15 * 60 });
  else jar.delete(NEXT_COOKIE);
}

/** Supabase's reasons, in words a person can act on. */
function sendError(e: { status?: number; code?: string; message?: string }, t: T): string {
  if (e.status === 429 || e.code === "over_email_send_rate_limit" || e.code === "over_request_rate_limit") {
    return t("That's a lot of codes in a short time. Wait a minute, then try again.");
  }
  if (e.code === "email_address_not_authorized") return t("Prism can't email that address yet — its email sending is still being set up.");
  if (e.code === "signup_disabled") return t("New accounts aren't open right now.");
  return t("We couldn't send a code just now. Try again in a minute.");
}

export async function signInStep(prev: SignInState, form: FormData): Promise<SignInState> {
  const t = await getT();
  const supabase = await supabaseServer();
  if (!supabase) return { step: "email", error: t("Accounts aren't switched on for this version of Prism yet.") };
  const intent = form.get("intent");
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (intent === "change") return { step: "email", email };

  if (intent === "send" || intent === "resend") {
    if (email.length > 254 || !EMAIL.test(email)) return { step: "email", email, error: t("Enter an email address like you@example.com.") };
    if (intent === "send") await rememberNext(form.get("next"));
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: `${await requestOrigin()}/auth/callback` },
    });
    if (error) return intent === "resend" ? { step: "code", email, error: sendError(error, t) } : { step: "email", email, error: sendError(error, t) };
    return { step: "code", email, resent: intent === "resend" };
  }

  if (intent === "verify") {
    const code = String(form.get("code") ?? "").replace(/[\s-]/g, "");
    if (!EMAIL.test(email)) return { step: "email", error: t("Start again with your email address.") };
    if (!/^\d{6,10}$/.test(code)) return { step: "code", email, error: t("Enter the code from the email — just the digits.") };
    const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) return { step: "code", email, error: t("That code didn't work. Check it, or send a new one — each code works once.") };
    const jar = await cookies();
    const next = safeNext(jar.get(NEXT_COOKIE)?.value);
    jar.delete(NEXT_COOKIE);
    // Two-step sign-in on: the email code was step one, and the authenticator code comes next.
    if (await secondStepPending(supabase)) redirect(twoStepPath(next));
    redirect(next ?? landingAfterSignIn(data.user));
  }
  return prev;
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase?.auth.signOut({ scope: "local" });
  redirect("/");
}

export type DeleteState = { error?: string };

/**
 * Gone means gone: every bank link is removed at Plaid and Coinbase access is
 * revoked at Coinbase BEFORE the account and all its rows are deleted, so no
 * live token outlives the person's decision.
 */
export async function deleteAccount(_prev: DeleteState, form: FormData): Promise<DeleteState> {
  const t = await getT();
  const account = await currentAccount();
  if (!account) redirect("/sign-in");
  const typed = String(form.get("confirm") ?? "")
    .trim()
    .toLowerCase();
  if (!account.email || typed !== account.email.toLowerCase()) return { error: t("Type your email address exactly to confirm.") };

  let key: VaultKey | null = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  const saved = await loadAccount(account, key);
  const plaid = plaidConfig();
  if (plaid) await Promise.all(saved.items.map((i) => removeItem(plaid, i.accessToken).catch(() => undefined)));
  const cb = coinbaseConfig();
  if (cb && key && saved.coinbase) {
    const token = await liveCoinbaseToken(account, saved.coinbase, cb, key).catch(() => null);
    if (token) await revokeToken(cb, token).catch(() => undefined);
  }

  const { error } = await account.supabase.rpc("delete_my_account");
  if (error) return { error: t("We couldn't delete the account just now. Nothing was removed — try again in a minute.") };
  await account.supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  redirect("/");
}
