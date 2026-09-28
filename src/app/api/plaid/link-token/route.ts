// POST /api/plaid/link-token — a short-lived token that opens Plaid Link for
// this browser's household. 503 with `not_configured` when no Plaid keys are
// set, which the client turns into the "you're on demo data" explanation.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createLinkToken, plaidConfig, PlaidError } from "@/lib/plaid/client";
import { sameOriginJson } from "@/lib/server/request-guard";
import { cookieOptions, emptyVault, open, seal, VAULT_COOKIE, vaultKey } from "@/lib/server/vault";
import { currentAccount } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const refused = sameOriginJson(req);
  if (refused) return NextResponse.json({ error: "bad_request", message: refused }, { status: 400 });

  const config = plaidConfig();
  if (!config) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  let key: Buffer | null;
  try {
    key = vaultKey();
  } catch (e) {
    return NextResponse.json({ error: "vault_key_invalid", message: (e as Error).message }, { status: 500 });
  }
  if (!key) return NextResponse.json({ error: "vault_key_missing", message: "Set PRISM_VAULT_KEY to link banks in production." }, { status: 500 });

  const account = await currentAccount();
  const jar = await cookies();
  const vault = account ? null : (open(jar.get(VAULT_COOKIE)?.value, key) ?? emptyVault());
  try {
    // One Plaid user per person: the account's id when signed in, else this browser's household id.
    const { link_token } = await createLinkToken(config, account?.userId ?? vault!.userId);
    if (vault) jar.set(VAULT_COOKIE, seal(vault, key), cookieOptions());
    return NextResponse.json({ linkToken: link_token, env: config.env });
  } catch (e) {
    const message = e instanceof PlaidError ? (e.displayMessage ?? e.code) : "Plaid is unreachable right now.";
    return NextResponse.json({ error: "plaid_error", message }, { status: 502 });
  }
}
