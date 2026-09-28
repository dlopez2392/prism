// GET /api/coinbase/callback — Coinbase sends the person back here.
//
// Checks the state against the sealed cookie this browser got on the way out
// (so nobody can splice their own Coinbase into someone else's Prism), trades
// the one-time code plus the PKCE verifier for tokens, seals them, and lands
// on Connections with a word about how it went. Any earlier link is revoked
// at Coinbase, so reconnecting never leaves a live token behind.

import { NextResponse, type NextRequest } from "next/server";
import { coinbaseConfig, exchangeCode, revokeToken } from "@/lib/coinbase/client";
import {
  COINBASE_COOKIE,
  COINBASE_OAUTH_COOKIE,
  finishSignIn,
  isExpired,
  linkCookieOptions,
  readLink,
  sealLink,
} from "@/lib/server/coinbase-store";
import { vaultKey } from "@/lib/server/vault";
import { liveCoinbaseToken, loadAccount, saveAccountCoinbase } from "@/lib/server/account-store";
import { currentAccount } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const back = (outcome: string) => {
    const res = NextResponse.redirect(new URL(`/connections?coinbase=${outcome}`, req.url), 303);
    res.cookies.delete(COINBASE_OAUTH_COOKIE);
    res.headers.set("Cache-Control", "no-store");
    return res;
  };

  const config = coinbaseConfig();
  let key: Buffer | null = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  if (!config || !key) return back("not_configured");

  const error = q.get("error");
  if (error) return back(error === "access_denied" ? "cancelled" : "failed");

  const pending = finishSignIn(req.cookies.get(COINBASE_OAUTH_COOKIE)?.value, q.get("state"), key);
  const code = q.get("code");
  if (!pending) return back("expired");
  if (!code) return back("failed");

  let tokens;
  try {
    tokens = await exchangeCode(config, { code, verifier: pending.verifier, redirectUri: pending.redirectUri });
  } catch {
    return back("failed");
  }

  const account = await currentAccount();
  if (account) {
    // Signed in: the link belongs to the account. Revoke any earlier one first.
    const earlier = (await loadAccount(account, key)).coinbase;
    if (earlier) {
      const live = await liveCoinbaseToken(account, earlier, config, key).catch(() => null);
      if (live) await revokeToken(config, live).catch(() => undefined);
    }
    try {
      await saveAccountCoinbase(account, tokens, key);
    } catch {
      await revokeToken(config, tokens.accessToken).catch(() => undefined);
      return back("failed");
    }
    return back("connected");
  }

  const previous = readLink(req.cookies.get(COINBASE_COOKIE)?.value, key);
  if (previous && !isExpired(previous)) {
    await revokeToken(config, previous.accessToken).catch(() => undefined);
  }

  const res = back("connected");
  res.cookies.set(COINBASE_COOKIE, sealLink(tokens, new Date().toISOString(), key), linkCookieOptions());
  return res;
}
