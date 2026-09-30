// src/lib/plaid/return.ts
//
// What Prism remembers while a person is away signing in on their bank's own
// website. Link has to be reopened with the SAME Link token when the bank
// sends them back, and by then the page that opened it is gone. So the token
// rides in an httpOnly cookie, along with the page to return to afterwards.
// The token is never kept in browser storage that scripts can read. It is
// only good for opening Link as this person, and the cookie outlives a slow
// bank sign-in by a margin and no more.
//
// The `__Host-` prefix means only this exact host can set the cookie, over
// HTTPS, for the whole site: a sibling subdomain can't plant its own Link
// token here. Chrome and Firefox treat http://localhost as secure, so local
// runs work too.

import { safeNext } from "@/lib/profile";

export const RETURN_COOKIE = "__Host-prism-bank-return";
/** An hour at the bank is plenty. Plaid's Link token itself lasts four. */
const RETURN_MAX_AGE = 60 * 60;
const LINK_TOKEN = /^link-(sandbox|production)-[\w-]{1,200}$/;
/** Where to land when the page that started the connection can't be trusted. */
export const RETURN_FALLBACK = "/connections";

/**
 * `reconnect`: the linked bank (its item id) Link was signing in to again —
 * Plaid's update mode — so there's nothing to exchange afterwards, and
 * "Try again" means that bank again, never a second connection to it.
 */
export type BankReturn = { linkToken: string; back: string; reconnect: string | null };
const ITEM_ID = /^[\w-]{1,200}$/;

export function packReturn(r: BankReturn): string {
  return Buffer.from(JSON.stringify({ t: r.linkToken, b: r.back, ...(r.reconnect ? { u: r.reconnect } : {}) }), "utf8").toString("base64url");
}

/** The saved return, or null when there is none or it isn't one of ours. */
export function readReturn(raw: string | undefined | null): BankReturn | null {
  if (!raw || raw.length > 2048) return null;
  try {
    const x = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { t?: unknown; b?: unknown; u?: unknown };
    if (typeof x.t !== "string" || !LINK_TOKEN.test(x.t)) return null;
    return { linkToken: x.t, back: returnPath(x.b), reconnect: typeof x.u === "string" && ITEM_ID.test(x.u) ? x.u : null };
  } catch {
    return null;
  }
}

/** A same-site path to go back to once the bank is linked, never the return page itself. */
export function returnPath(x: unknown): string {
  const path = safeNext(x);
  return path && !path.startsWith("/connections/return") ? path : RETURN_FALLBACK;
}

/**
 * What /connections/return shows:
 * - `resume`: back from the bank with a saved Link token, so reopen Link.
 * - `unfinished`: back from the bank with nothing to resume. It was already
 *   finished (Back after success lands here), the hour ran out, or the bank
 *   opened a different browser.
 * - `empty`: not sent here by a bank at all.
 */
export type ReturnView = ({ kind: "resume" } & BankReturn) | { kind: "unfinished" } | { kind: "empty" };

export function returnView(oauthStateId: unknown, rawCookie: string | undefined | null): ReturnView {
  if (typeof oauthStateId !== "string" || oauthStateId.length === 0) return { kind: "empty" };
  const saved = readReturn(rawCookie);
  return saved ? { kind: "resume", ...saved } : { kind: "unfinished" };
}

export function returnCookieOptions() {
  return { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: RETURN_MAX_AGE };
}

/**
 * Clearing a `__Host-` cookie takes a Set-Cookie with the same Secure and
 * Path=/ attributes. A browser ignores a bare delete, so clear it with this.
 */
export function clearedReturnCookie() {
  return { ...returnCookieOptions(), maxAge: 0 };
}
