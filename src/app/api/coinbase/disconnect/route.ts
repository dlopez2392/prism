// POST /api/coinbase/disconnect — revokes the link AT COINBASE, then forgets it.
//
// Revoking the access token kills its paired refresh token too. If the access
// token has lapsed, one refresh buys a live one to revoke — the new refresh
// token dies with it. The cookie goes either way: the person asked for it to
// be gone, and a stale link here helps nobody.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { coinbaseConfig, refreshTokens, revokeToken } from "@/lib/coinbase/client";
import { COINBASE_COOKIE, needsRefresh, readLink } from "@/lib/server/coinbase-store";
import { sameOriginJson } from "@/lib/server/request-guard";
import { vaultKey } from "@/lib/server/vault";

export async function POST(req: Request) {
  const refused = sameOriginJson(req);
  if (refused) return NextResponse.json({ error: "bad_request", message: refused }, { status: 400 });

  const config = coinbaseConfig();
  let key: Buffer | null = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  const jar = await cookies();
  const link = key ? readLink(jar.get(COINBASE_COOKIE)?.value, key) : null;

  let revoked = false;
  if (config && link) {
    let access = link.accessToken;
    if (needsRefresh(link)) {
      access = await refreshTokens(config, link.refreshToken)
        .then((t) => t.accessToken)
        .catch(() => access);
    }
    revoked = await revokeToken(config, access)
      .then(() => true)
      .catch(() => false);
  }

  jar.delete(COINBASE_COOKIE);
  return NextResponse.json({ ok: true, revoked });
}
