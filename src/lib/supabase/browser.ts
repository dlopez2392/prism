// src/lib/supabase/browser.ts
//
// The one job Prism gives a Supabase client in the browser: checking a code
// from the person's authenticator app. Supabase requires a code's challenge
// and its answer to come from the same address, which a server action can't
// promise (see lib/server/two-step-actions.ts). A code that checks out
// upgrades the session in the same `prism-auth` cookie the server reads, so
// the very next request is the upgraded one. Nothing else here reads data;
// pages still get everything from the server.

import { createBrowserClient } from "@supabase/ssr";
import { AUTH_COOKIE, type SupabaseEnv } from "./config";

export type CodeCheck = { ok: true } | { ok: false; error: string };

/** "123 456", "123-456" and "123456" are the same code. */
export const cleanCode = (raw: string) => raw.replace(/[\s-]/g, "");

/**
 * Checks `raw` against the person's authenticator `factorId`. On success the
 * session now carries it. On failure, what went wrong, in words; the code
 * itself is never logged or sent anywhere but Supabase.
 */
export async function checkCode(env: SupabaseEnv, factorId: string, raw: string): Promise<CodeCheck> {
  const code = cleanCode(raw);
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "Enter the 6-digit code from your authenticator app." };
  const supabase = createBrowserClient(env.url, env.key, {
    cookieOptions: { name: AUTH_COOKIE },
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });
  try {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    return error ? { ok: false, error: codeError(error) } : { ok: true };
  } catch {
    return { ok: false, error: "We couldn't check your code just now. Check your connection and try again." };
  }
}

/**
 * Why Supabase said no, in words. Only a code it actually compared and
 * refused is "didn't match": anything else (no connection, an outage, a
 * session that has ended) says so, or someone would keep retyping a right
 * code against a problem the code can't fix.
 */
export function codeError(e: { status?: number; code?: string }): string {
  if (e.status === 429 || e.code === "over_request_rate_limit") return "That's a lot of tries. Wait a minute, then enter the code showing now.";
  if (e.code === "mfa_verification_failed" || e.code === "mfa_challenge_expired") return "That code didn't match. Codes change every 30 seconds, so enter the one showing now.";
  if (e.status === 401 || e.code === "session_not_found" || e.code === "session_expired") return "Your sign-in has ended. Sign in again, then enter a new code.";
  return "We couldn't check your code just now. Check your connection and try again.";
}
