// GET /auth/callback — where the link in a sign-in email lands.
//
// Handles both link styles Supabase can send: a PKCE `code` (the default,
// valid only in the browser that asked for it) or a `token_hash` (a custom
// email template). Either way the session is written as cookies on this
// response; a used or expired link goes back to sign-in with a word about it.

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

const LINK_TYPES: EmailOtpType[] = ["email", "magiclink", "signup"];

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const q = req.nextUrl.searchParams;
  let ok = false;
  if (supabase) {
    const code = q.get("code");
    const tokenHash = q.get("token_hash");
    const type = q.get("type") as EmailOtpType | null;
    if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
    else if (tokenHash && type && LINK_TYPES.includes(type)) ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  }
  const res = NextResponse.redirect(new URL(ok ? "/" : "/sign-in?error=link", req.url), 303);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
