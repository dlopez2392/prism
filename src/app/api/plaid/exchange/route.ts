// POST /api/plaid/exchange — trades Link's one-time public token for a
// long-lived access token and seals it: into the signed-in person's account,
// or into this browser's vault cookie when nobody is signed in. The access
// token never leaves the server in a readable form.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exchangePublicToken, getAccounts, getInstitutionName, plaidConfig, PlaidError } from "@/lib/plaid/client";
import { addAccountPlaidItem, loadAccount } from "@/lib/server/account-store";
import { sameOriginJson } from "@/lib/server/request-guard";
import { cookieOptions, emptyVault, open, seal, VAULT_COOKIE, vaultKey, type VaultItem } from "@/lib/server/vault";
import { currentAccount } from "@/lib/supabase/server";

const MAX_ITEMS = 8;

export async function POST(req: Request) {
  const refused = sameOriginJson(req);
  if (refused) return NextResponse.json({ error: "bad_request", message: refused }, { status: 400 });

  const config = plaidConfig();
  let key: Buffer | null = null;
  try {
    key = config ? vaultKey() : null;
  } catch (e) {
    return NextResponse.json({ error: "vault_key_invalid", message: (e as Error).message }, { status: 500 });
  }
  if (!config || !key) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { publicToken?: unknown } | null;
  const publicToken = typeof body?.publicToken === "string" ? body.publicToken : "";
  if (!/^public-(sandbox|production)-[\w-]+$/.test(publicToken)) {
    return NextResponse.json({ error: "bad_request", message: "Missing public token." }, { status: 400 });
  }

  const account = await currentAccount();
  const jar = await cookies();
  const vault = account ? null : (open(jar.get(VAULT_COOKIE)?.value, key) ?? emptyVault());
  const linked = account ? (await loadAccount(account, key)).items.length : vault!.items.length;
  if (linked >= MAX_ITEMS) {
    return NextResponse.json({ error: "too_many", message: `Prism links up to ${MAX_ITEMS} institutions.` }, { status: 409 });
  }

  try {
    const { access_token, item_id } = await exchangePublicToken(config, publicToken);
    const { item } = await getAccounts(config, access_token);
    const institutionName = item.institution_id ? await getInstitutionName(config, item.institution_id) : null;
    const entry: VaultItem = { itemId: item_id, accessToken: access_token, institutionId: item.institution_id, institutionName, linkedAt: new Date().toISOString() };
    if (account) {
      await addAccountPlaidItem(account, entry, key);
    } else {
      vault!.items = [...vault!.items.filter((i) => i.itemId !== item_id), entry];
      jar.set(VAULT_COOKIE, seal(vault!, key), cookieOptions());
    }
    return NextResponse.json({ ok: true, institutionName });
  } catch (e) {
    const message = e instanceof PlaidError ? (e.displayMessage ?? e.code) : "Plaid is unreachable right now.";
    return NextResponse.json({ error: "plaid_error", message }, { status: 502 });
  }
}
