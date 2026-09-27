// POST /api/plaid/disconnect — revokes an Item at Plaid (so the access token
// is dead, not just forgotten) and drops it from the vault.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { plaidConfig, removeItem } from "@/lib/plaid/client";
import { sameOriginJson } from "@/lib/server/request-guard";
import { cookieOptions, open, seal, VAULT_COOKIE, vaultKey } from "@/lib/server/vault";

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

  const body = (await req.json().catch(() => null)) as { itemId?: unknown } | null;
  const itemId = typeof body?.itemId === "string" ? body.itemId : "";
  const jar = await cookies();
  const vault = open(jar.get(VAULT_COOKIE)?.value, key);
  const item = vault?.items.find((i) => i.itemId === itemId);
  if (!vault || !item) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    await removeItem(config, item.accessToken);
  } catch {
    // Already revoked or unreachable: still forget it locally — the user asked
    // for it to be gone, and a stale token here helps nobody.
  }
  vault.items = vault.items.filter((i) => i.itemId !== itemId);
  jar.set(VAULT_COOKIE, seal(vault, key), cookieOptions());
  return NextResponse.json({ ok: true });
}
