// GET /auth/callback — where the link in a sign-in email lands.
//
// Handles both link styles Supabase can send: a PKCE `code` (the default,
// valid only in the browser that asked for it) or a `token_hash` (a custom
// email template). Either way the session is written as cookies on this
// response; a used or expired link goes back to sign-in with a word about it.
// An account's very first sign-in lands on the welcome step, as a code does.

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType, User } from "@supabase/supabase-js";
import { landingAfterSignIn } from "@/lib/profile";
import { supabaseServer } from "@/lib/supabase/server";

const LINK_TYPES: EmailOtpType[] = ["email", "magiclink", "signup"];

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const q = req.nextUrl.searchParams;
  let ok = false;
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
  }
  const res = NextResponse.redirect(new URL(ok ? landingAfterSignIn(user) : "/sign-in?error=link", req.url), 303);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
