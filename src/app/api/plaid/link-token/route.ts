// POST /api/plaid/link-token — a short-lived token that opens Plaid Link for
// this browser's household. 503 with `not_configured` when no Plaid keys are
// set, which the client turns into the "you're on demo data" explanation.
//
// Body: `{ from }`, the page the person is on, so that a bank which signs
// them in on its own website can send them back to it
// (/connections/return).
//
// With accounts on, only a signed-in account may connect a bank: 401
// `sign_in_required` otherwise (src/lib/linking.ts says why).

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createLinkToken, plaidConfig, PlaidError, redirectUriFor } from "@/lib/plaid/client";
import { clearedReturnCookie, packReturn, RETURN_COOKIE, returnCookieOptions, returnPath } from "@/lib/plaid/return";
import { linkingRefusal } from "@/lib/linking";
import { requestOrigin } from "@/lib/server/origin";
import { sameOriginJson } from "@/lib/server/request-guard";
import { cookieOptions, emptyVault, open, seal, VAULT_COOKIE, vaultKey, type VaultKey } from "@/lib/server/vault";
import { supabaseEnv } from "@/lib/supabase/config";
import { currentAccount } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const refused = sameOriginJson(req);
  if (refused) return NextResponse.json({ error: "bad_request", message: refused }, { status: 400 });

  const config = plaidConfig();
  if (!config) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  let key: VaultKey | null;
  try {
    key = vaultKey();
  } catch (e) {
    return NextResponse.json({ error: "vault_key_invalid", message: (e as Error).message }, { status: 500 });
  }
  if (!key) return NextResponse.json({ error: "vault_key_missing", message: "Set PRISM_VAULT_KEY to link banks in production." }, { status: 500 });

  const body = (await req.json().catch(() => null)) as { from?: unknown } | null;
  const account = await currentAccount();
  const refusal = linkingRefusal({ accountsEnabled: supabaseEnv() !== null, signedIn: account !== null, realMoney: config.env !== "sandbox" });
  if (refusal) return NextResponse.json({ error: refusal.error, message: refusal.message }, { status: refusal.status });
  const jar = await cookies();
  const vault = account ? null : (open(jar.get(VAULT_COOKIE)?.value, key) ?? emptyVault());
  // The origin as the browser saw it (a TLS-terminating proxy makes req.url say http).
  const origin = await requestOrigin();
  const redirect = redirectUriFor(process.env, origin, config.env);
  if (redirect.problem) console.warn(`Plaid redirect left out: ${redirect.problem}.`);
  try {
    // One Plaid user per person: the account's id when signed in, else this browser's household id.
    // Plaid announces new transactions to this site's webhook — over HTTPS only, so not from a laptop.
    const hook = new URL("/api/plaid/webhook", origin);
    const userId = account?.userId ?? vault!.userId;
    const webhookUrl = hook.protocol === "https:" ? hook.href : null;
    let redirectUri = redirect.uri;
    let linkToken: string;
    try {
      linkToken = (await createLinkToken(config, userId, { webhookUrl, redirectUri })).link_token;
    } catch (e) {
      // Plaid refuses an address missing from its allow-list, and a setting made before (or
      // without) that step must never stop anyone linking: without it the bank opens in a pop-up.
      if (!redirectUri || !(e instanceof PlaidError) || !["INVALID_FIELD", "INVALID_REQUEST"].includes(e.code)) throw e;
      console.error(`Plaid refused PLAID_REDIRECT_URI (${redirectUri}): ${e.message}. Add it to Allowed redirect URIs in Plaid's dashboard. Linking without it.`);
      redirectUri = null;
      linkToken = (await createLinkToken(config, userId, { webhookUrl })).link_token;
    }
    if (vault) jar.set(VAULT_COOKIE, seal(vault, key), cookieOptions());
    // Only a token Plaid may redirect with needs remembering; any older one is dropped either way.
    if (redirectUri) jar.set(RETURN_COOKIE, packReturn({ linkToken, back: returnPath(body?.from) }), returnCookieOptions());
    else if (jar.has(RETURN_COOKIE)) jar.set(RETURN_COOKIE, "", clearedReturnCookie());
    return NextResponse.json({ linkToken, env: config.env });
  } catch (e) {
    const message = e instanceof PlaidError ? (e.displayMessage ?? e.code) : "Plaid is unreachable right now.";
    return NextResponse.json({ error: "plaid_error", message }, { status: 502 });
  }
}
