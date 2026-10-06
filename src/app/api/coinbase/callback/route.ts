// GET /api/coinbase/callback — Coinbase sends the person back here.
//
// Checks the state against the sealed cookie this browser got on the way out
// (so nobody can splice their own Coinbase into someone else's Prism), trades
// the one-time code plus the PKCE verifier for tokens, seals them, and lands
// on Connections with a word about how it went. Any earlier link is revoked
// at Coinbase, so reconnecting never leaves a live token behind.
//
// The link is kept only in a signed-in account (src/lib/linking.ts). Links
// made before that rule stay readable in their cookie until sign-in moves
// them into the account, but this route never writes a new one.

import { NextResponse, type NextRequest } from "next/server";
import { pricingFor } from "@/lib/billing/plans";
import { connectionNeedsPlus } from "@/lib/billing/plus";
import { coinbaseConfig, exchangeCode, revokeToken } from "@/lib/coinbase/client";
import { COINBASE_OAUTH_COOKIE, finishSignIn } from "@/lib/server/coinbase-store";
import { vaultKey, type VaultKey } from "@/lib/server/vault";
import { liveCoinbaseToken, loadAccount, saveAccountCoinbase } from "@/lib/server/account-store";
import { linkingRefusal, signInToConnect } from "@/lib/linking";
import { supabaseEnv } from "@/lib/supabase/config";
import { currentAccount } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const leave = (to: string) => {
    const res = NextResponse.redirect(new URL(to, req.url), 303);
    res.cookies.delete(COINBASE_OAUTH_COOKIE);
    res.headers.set("Cache-Control", "no-store");
    return res;
  };
  const back = (outcome: string) => leave(`/connections?coinbase=${outcome}`);

  const config = coinbaseConfig();
  let key: VaultKey | null = null;
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

  // Checked before Coinbase is asked for anything: a session that ended mid-way gets no tokens at all.
  const account = await currentAccount();
  const refusal = linkingRefusal({ accountsEnabled: supabaseEnv() !== null, signedIn: account !== null, realMoney: true, kind: "coinbase" });
  if (refusal || !account) return refusal?.error === "accounts_required" ? back("accounts_required") : leave(signInToConnect("coinbase", "/connections"));
  if (await connectionNeedsPlus(account, "coinbase")) return leave(pricingFor("coinbase"));

  let tokens;
  try {
    tokens = await exchangeCode(config, { code, verifier: pending.verifier, redirectUri: pending.redirectUri });
  } catch {
    return back("failed");
  }

  // The link belongs to the account. Revoke any earlier one first.
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
