"use server";

// src/lib/server/two-step-actions.ts
//
// Two-step sign-in with an authenticator app (TOTP): the server's half of
// turning it on and off from the Account page. Supabase Auth keeps the
// authenticator's secret and checks the codes; Prism records which
// authenticator is the person's own (profiles.totp_factor_id), and the
// database refuses their rows to any session that hasn't passed it (migration
// two_step_sign_in).
//
// Codes are checked in the BROWSER (lib/supabase/browser.ts), never here.
// Supabase requires a code's challenge and its answer to come from the same
// address, and a server action's requests leave from whichever machine runs
// it, so a server-side check fails as `mfa_ip_address_mismatch`. That costs
// nothing in trust: a code checked in the browser upgrades the session
// itself, and the database — not this file — decides what that session may
// do. Recording an authenticator only succeeds for a session that has just
// passed that very one (check_totp_registration), and turning it off reads
// the session's own signed record of when a code was last entered.

import { refresh } from "next/cache";
import { BRAND } from "@/lib/brand";
import { getT } from "@/lib/i18n/server";
import { currentAccount } from "@/lib/supabase/server";

/** How recently a code must have been entered to turn two-step sign-in off. (Not exported: a "use server" file exports only actions.) */
const FRESH_CODE_S = 5 * 60;

export type SetupStart = { ok: true; factorId: string; qrCode: string; secret: string } | { ok: false; error: string };
export type SetupResult = { ok: true } | { ok: false; error: string };

/**
 * Step one of turning it on: a new authenticator for the person to scan. An
 * earlier set-up they abandoned is cleared first. It was never verified, so
 * it never counted for anything.
 */
export async function startSetup(): Promise<SetupStart> {
  const t = await getT();
  const account = await currentAccount();
  if (!account) return { ok: false, error: t("Sign in again to set up two-step sign-in.") };
  const mfa = account.supabase.auth.mfa;
  const { data: factors } = await mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.factor_type === "totp" && f.status === "unverified") await mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await mfa.enroll({ factorType: "totp", issuer: "Prism", friendlyName: `Prism ${new Date().toISOString().slice(0, 19)}` });
  if (error || !data) {
    // Supabase refuses a new authenticator while one it already verified exists. Here that
    // can only be one Prism never registered, which support clears.
    return { ok: false, error: t("We couldn't start set-up for this account. Email {email} and we'll sort it out.", { email: BRAND.privacyEmail }) };
  }
  return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/**
 * Step two of turning it on, after the browser has checked a code from the
 * new authenticator: record it as the person's own. The database accepts that
 * record only from a session that has just passed this very factor, so an id
 * sent here without the code is refused.
 */
export async function registerFactor(factorId: string): Promise<SetupResult> {
  const t = await getT();
  const account = await currentAccount();
  if (!account) return { ok: false, error: t("Sign in again to set up two-step sign-in.") };
  if (typeof factorId !== "string" || !/^[0-9a-f-]{36}$/.test(factorId)) return { ok: false, error: t("Start set-up again.") };
  const { error } = await account.supabase.from("profiles").update({ totp_factor_id: factorId }).eq("user_id", account.userId);
  if (error) return { ok: false, error: t("Your code worked, but we couldn't switch two-step sign-in on. Start set-up again.") };
  refresh();
  return { ok: true };
}

/**
 * Turning it off takes a code from the last five minutes, so a session left
 * open on someone else's computer can't quietly remove it. "When was a code
 * last entered" comes from the session's signed token (its `amr` claim),
 * which the browser can't write. The record is cleared before the
 * authenticator is removed: in the other order, a failure would leave the
 * person owing a code from an authenticator that no longer exists.
 */
export async function turnOff(): Promise<SetupResult> {
  const t = await getT();
  const account = await currentAccount();
  if (!account) return { ok: false, error: t("Sign in again to change two-step sign-in.") };
  const { data: factorId } = await account.supabase.rpc("my_second_step_factor");
  if (typeof factorId !== "string") {
    refresh();
    return { ok: true };
  }
  const { data } = await account.supabase.auth.getClaims();
  if (!codeEnteredWithin(data?.claims?.amr, FRESH_CODE_S)) return { ok: false, error: t("Enter a current code from your authenticator app first.") };
  const { error: cleared } = await account.supabase.from("profiles").update({ totp_factor_id: null }).eq("user_id", account.userId);
  if (cleared) return { ok: false, error: t("We couldn't turn two-step sign-in off just now. Try again.") };
  await account.supabase.auth.mfa.unenroll({ factorId });
  refresh();
  return { ok: true };
}

/** Whether the token says an authenticator code was entered in the last `seconds`. The bare-string form carries no time, so it never counts. */
function codeEnteredWithin(amr: unknown, seconds: number): boolean {
  if (!Array.isArray(amr)) return false;
  const now = Date.now() / 1000;
  return amr.some((e) => e && typeof e === "object" && e.method === "totp" && typeof e.timestamp === "number" && now - e.timestamp <= seconds && e.timestamp <= now + 60);
}
