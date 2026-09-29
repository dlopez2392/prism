// GET /api/coinbase/connect — leave for Coinbase's own sign-in screen.
//
// A plain link, not a form: starting a sign-in grants nothing by itself, and
// the person still approves read-only access on coinbase.com. The PKCE
// verifier and the anti-forgery state wait in a sealed ten-minute cookie so
// only THIS browser can finish what it started.
//
// Coinbase is always real money, so it connects only to a signed-in account;
// anyone else is sent to sign in first (src/lib/linking.ts).

import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, coinbaseConfig } from "@/lib/coinbase/client";
import { linkingRefusal, signInToConnect } from "@/lib/linking";
import { COINBASE_OAUTH_COOKIE, pendingCookieOptions, redirectUriFor, startSignIn } from "@/lib/server/coinbase-store";
import { vaultKey } from "@/lib/server/vault";
import { supabaseEnv } from "@/lib/supabase/config";
import { currentAccount } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const config = coinbaseConfig();
  let key: Buffer | null = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  if (!config || !key) return NextResponse.redirect(new URL("/connections?coinbase=not_configured", req.url), 303);
  const refusal = linkingRefusal({ accountsEnabled: supabaseEnv() !== null, signedIn: (await currentAccount()) !== null, realMoney: true, kind: "coinbase" });
  if (refusal?.error === "sign_in_required") return NextResponse.redirect(new URL(signInToConnect("coinbase", "/connections"), req.url), 303);
  if (refusal) return NextResponse.redirect(new URL("/connections?coinbase=accounts_required", req.url), 303);

  const redirectUri = redirectUriFor(config, req.nextUrl.origin);
  const { cookie, state, challenge } = startSignIn(redirectUri, key);
  const res = NextResponse.redirect(authorizeUrl(config, { state, challenge, redirectUri }), 303);
  res.cookies.set(COINBASE_OAUTH_COOKIE, cookie, pendingCookieOptions());
  res.headers.set("Cache-Control", "no-store");
  return res;
}
