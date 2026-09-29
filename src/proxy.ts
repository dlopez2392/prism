// src/proxy.ts
//
// Keeps two kinds of session alive before a page renders, because a page
// render can't set cookies and both kinds spend single-use refresh tokens:
//
//   1. A Prism account session (Supabase): getClaims() refreshes it when due,
//      and the new cookies go to this request AND to the browser. Returning
//      any other response than the one carrying them would sign the person
//      out on their next click.
//   2. A device-only Coinbase link (the prism-coinbase cookie): refreshed
//      shortly before its hour is up, stored in the same breath. On failure
//      the cookie is left alone — a concurrent request may already hold the
//      new pair — and the page says "needs you to sign in".
//
// It runs only for browsers holding one of those cookies (the `has`
// conditions), so a first-time visitor pays nothing, and it skips prefetches
// so two requests never race to spend the same token.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { coinbaseConfig } from "@/lib/coinbase/client";
import { COINBASE_COOKIE, linkCookieOptions, refreshLink } from "@/lib/server/coinbase-store";
import { vaultKey, type VaultKey } from "@/lib/server/vault";
import { AUTH_COOKIE, hasSessionCookie, supabaseEnv } from "@/lib/supabase/config";

type Pending = { name: string; value: string; options: CookieOptions };

export async function proxy(request: NextRequest) {
  const cookies: Pending[] = [];
  const headers: Record<string, string> = {};

  const env = supabaseEnv();
  if (env && hasSessionCookie(request.cookies.getAll().map((c) => c.name))) {
    const supabase = createServerClient(env.url, env.key, {
      cookieOptions: { name: AUTH_COOKIE },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list, cacheHeaders) {
          for (const c of list) {
            request.cookies.set(c.name, c.value);
            cookies.push(c);
          }
          Object.assign(headers, cacheHeaders);
        },
      },
    });
    // Nothing may run between creating the client and this call.
    await supabase.auth.getClaims();
  }

  const config = coinbaseConfig();
  let key: VaultKey | null = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  if (config && key) {
    const sealed = await refreshLink(request.cookies.get(COINBASE_COOKIE)?.value, key, config);
    if (sealed) {
      request.cookies.set(COINBASE_COOKIE, sealed);
      cookies.push({ name: COINBASE_COOKIE, value: sealed, options: linkCookieOptions() });
    }
  }

  if (cookies.length === 0) return NextResponse.next();
  const response = NextResponse.next({ request: { headers: request.headers } });
  for (const { name, value, options } of cookies) response.cookies.set(name, value, options);
  for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
  return response;
}

// Literals only, repeated on purpose: Next reads this config at build time
// and refuses anything it can't evaluate statically. A session cookie longer
// than 3,180 bytes is split into prism-auth.0, prism-auth.1, …
export const config = {
  matcher: [
    {
      source: "/((?!api/|_next/static|_next/image|icon.svg|calendar/demo.ics|calendar/feed/).*)",
      has: [{ type: "cookie", key: "prism-auth" }],
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    {
      source: "/((?!api/|_next/static|_next/image|icon.svg|calendar/demo.ics|calendar/feed/).*)",
      has: [{ type: "cookie", key: "prism-auth.0" }],
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    {
      source: "/((?!api/|_next/static|_next/image|icon.svg|calendar/demo.ics|calendar/feed/).*)",
      has: [{ type: "cookie", key: "prism-coinbase" }],
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
