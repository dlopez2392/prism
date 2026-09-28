"use server";

// src/lib/server/auth-actions.ts
//
// Sign in with a one-time code by email — no password to leak or forget.
// The same email also carries a link that signs in on the device it's opened
// on (/auth/callback). Sign out, and delete the account for good.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { coinbaseConfig, revokeToken } from "@/lib/coinbase/client";
import { plaidConfig, removeItem } from "@/lib/plaid/client";
import { currentAccount, supabaseServer } from "@/lib/supabase/server";
import { liveCoinbaseToken, loadAccount } from "./account-store";
import { vaultKey } from "./vault";

export type SignInState =
  | { step: "email"; email?: string; firstName?: string; error?: string }
  | { step: "code"; email: string; error?: string; resent?: boolean };

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@.]{2,}$/;

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3100";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

function cleanFirstName(x: FormDataEntryValue | null): string | null {
  const s = typeof x === "string" ? x.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim() : "";
  return s && [...s].length <= 40 ? s : null;
}

/** Supabase's reasons, in words a person can act on. */
function sendError(e: { status?: number; code?: string; message?: string }): string {
  if (e.status === 429 || e.code === "over_email_send_rate_limit" || e.code === "over_request_rate_limit") {
    return "That's a lot of codes in a short time. Wait a minute, then try again.";
  }
  if (e.code === "email_address_not_authorized") return "Prism can't email that address yet — its email sending is still being set up.";
  if (e.code === "signup_disabled") return "New accounts aren't open right now.";
  return "We couldn't send a code just now. Try again in a minute.";
}

export async function signInStep(prev: SignInState, form: FormData): Promise<SignInState> {
  const supabase = await supabaseServer();
  if (!supabase) return { step: "email", error: "Accounts aren't switched on for this version of Prism yet." };
  const intent = form.get("intent");
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (intent === "change") return { step: "email", email };

  if (intent === "send" || intent === "resend") {
    const firstName = cleanFirstName(form.get("firstName"));
    if (email.length > 254 || !EMAIL.test(email)) return { step: "email", email, firstName: firstName ?? undefined, error: "Enter an email address like you@example.com." };
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: `${await origin()}/auth/callback`, data: firstName ? { first_name: firstName } : undefined },
    });
    if (error) return intent === "resend" ? { step: "code", email, error: sendError(error) } : { step: "email", email, firstName: firstName ?? undefined, error: sendError(error) };
    return { step: "code", email, resent: intent === "resend" };
  }

  if (intent === "verify") {
    const code = String(form.get("code") ?? "").replace(/[\s-]/g, "");
    if (!EMAIL.test(email)) return { step: "email", error: "Start again with your email address." };
    if (!/^\d{6,10}$/.test(code)) return { step: "code", email, error: "Enter the code from the email — just the digits." };
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) return { step: "code", email, error: "That code didn't work. Check it, or send a new one — each code works once." };
    redirect("/");
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
  const account = await currentAccount();
  if (!account) redirect("/sign-in");
  const typed = String(form.get("confirm") ?? "")
    .trim()
    .toLowerCase();
  if (!account.email || typed !== account.email.toLowerCase()) return { error: "Type your email address exactly to confirm." };

  let key: Buffer | null = null;
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
  if (error) return { error: "We couldn't delete the account just now. Nothing was removed — try again in a minute." };
  await account.supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  redirect("/");
}
