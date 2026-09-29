// POST /api/plaid/disconnect — revokes an Item at Plaid (so the access token
// is dead, not just forgotten) and drops it from the account or the vault.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { plaidConfig, removeItem } from "@/lib/plaid/client";
import { loadAccount, removeAccountPlaidItem } from "@/lib/server/account-store";
import { sameOriginJson } from "@/lib/server/request-guard";
import { cookieOptions, open, seal, VAULT_COOKIE, vaultKey, type VaultKey } from "@/lib/server/vault";
import { currentAccount } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const refused = sameOriginJson(req);
  if (refused) return NextResponse.json({ error: "bad_request", message: refused }, { status: 400 });

  const config = plaidConfig();
  let key: VaultKey | null = null;
  try {
    key = config ? vaultKey() : null;
  } catch (e) {
    return NextResponse.json({ error: "vault_key_invalid", message: (e as Error).message }, { status: 500 });
  }
  if (!config || !key) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { itemId?: unknown } | null;
  const itemId = typeof body?.itemId === "string" ? body.itemId : "";
  const account = await currentAccount();
  const jar = await cookies();
  const vault = account ? null : open(jar.get(VAULT_COOKIE)?.value, key);
  const item = account ? (await loadAccount(account, key)).items.find((i) => i.itemId === itemId) : vault?.items.find((i) => i.itemId === itemId);
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    await removeItem(config, item.accessToken);
  } catch {
    // Already revoked or unreachable: still forget it — the person asked for
    // it to be gone, and a stale token here helps nobody.
  }
  if (account) {
    await removeAccountPlaidItem(account, itemId);
  } else if (vault) {
    vault.items = vault.items.filter((i) => i.itemId !== itemId);
    jar.set(VAULT_COOKIE, seal(vault, key), cookieOptions());
  }
  return NextResponse.json({ ok: true });
}
