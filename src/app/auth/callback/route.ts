// GET /auth/callback — where the link in a sign-in email lands.
//
// Handles both link styles Supabase can send: a PKCE `code` (the default,
// valid only in the browser that asked for it) or a `token_hash` (a custom
// email template). Either way the session is written as cookies on this
// response; a used or expired link goes back to sign-in with a word about it.
// Like a code, it returns to whatever sign-in interrupted (approving a
// connected app), else lands a brand-new account on the welcome step. With
// two-step sign-in on, the link is step one, and the authenticator code is next.

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType, User } from "@supabase/supabase-js";
import { landingAfterSignIn, NEXT_COOKIE, safeNext } from "@/lib/profile";
import { secondStepPending, supabaseServer, twoStepPath } from "@/lib/supabase/server";

const LINK_TYPES: EmailOtpType[] = ["email", "magiclink", "signup"];

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const q = req.nextUrl.searchParams;
  let ok = false;
  let twoStep = false;
  let user: User | null = null;
  if (supabase) {
    const code = q.get("code");
    const tokenHash = q.get("token_hash");
    const type = q.get("type") as EmailOtpType | null;
    const result = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : tokenHash && type && LINK_TYPES.includes(type)
        ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        : null;
    ok = result !== null && !result.error;
    user = result?.data.user ?? null;
    twoStep = ok && (await secondStepPending(supabase));
  }
  const next = safeNext(req.cookies.get(NEXT_COOKIE)?.value);
  const to = !ok ? "/sign-in?error=link" : twoStep ? twoStepPath(next) : (next ?? landingAfterSignIn(user));
  const res = NextResponse.redirect(new URL(to, req.url), 303);
  if (ok) res.cookies.delete(NEXT_COOKIE);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
