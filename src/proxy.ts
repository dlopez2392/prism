// src/proxy.ts
//
// Keeps a Coinbase link alive. Coinbase access tokens last an hour and each
// refresh token works ONCE, so a refresh is only safe where the new pair can
// be stored in the same breath — and a page render can't set cookies. The
// proxy can: it refreshes shortly before expiry, hands the new cookie to this
// very request (so the page renders with a live token) and to the browser.
//
// It runs only for browsers holding a Coinbase link (the `has` condition), so
// everyone else pays nothing. Prefetches are skipped so two requests never
// race to spend the same refresh token. On failure the cookie is left as it
// is: a concurrent request may already have stored the pair this one lost,
// and a dead link shows up on the page as "needs you to sign in".

import { NextResponse, type NextRequest } from "next/server";
import { coinbaseConfig } from "@/lib/coinbase/client";
import { COINBASE_COOKIE, linkCookieOptions, refreshLink } from "@/lib/server/coinbase-store";
import { vaultKey } from "@/lib/server/vault";

export async function proxy(request: NextRequest) {
  const config = coinbaseConfig();
  let key: Buffer | null = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  if (!config || !key) return NextResponse.next();

  const sealed = await refreshLink(request.cookies.get(COINBASE_COOKIE)?.value, key, config);
  if (!sealed) return NextResponse.next();

  request.cookies.set(COINBASE_COOKIE, sealed);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(COINBASE_COOKIE, sealed, linkCookieOptions());
  return response;
}

export const config = {
  matcher: [
    {
      // Pages, Server Actions and the calendar download; never the API routes
      // (the Coinbase ones manage the cookie themselves) or static files.
      source: "/((?!api/|_next/static|_next/image|icon.svg|calendar/demo.ics).*)",
      // A literal, not COINBASE_COOKIE: Next reads this config at build time.
      has: [{ type: "cookie", key: "prism-coinbase" }],
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
