// src/lib/profile.ts
//
// The person behind an account: the first name Prism greets them by, and
// where a sign-in lands. The name is asked for AFTER sign-in, never beside
// the email box — an optional field next to a sign-in form is exactly where
// people type a password by mistake — and it has to read as a name: letters,
// with the marks, spaces, apostrophes, hyphens and periods names carry. No
// digits or symbols, so a password pasted into the field is refused, not kept.

export const FIRST_NAME_MAX = 40;

const NAME = /^\p{L}[\p{L}\p{M}'’. -]*$/u;

export type FirstNameRead = { ok: true; name: string | null } | { ok: false; error: string };

/** A submitted first name, cleaned. Blank means "go without one". */
export function readFirstName(x: FormDataEntryValue | null): FirstNameRead {
  const s = typeof x === "string" ? x.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim() : "";
  if (!s) return { ok: true, name: null };
  if ([...s].length > FIRST_NAME_MAX) return { ok: false, error: `Keep it to ${FIRST_NAME_MAX} letters or fewer.` };
  if (!NAME.test(s)) return { ok: false, error: "Use letters only — just the first name Prism should greet you by." };
  return { ok: true, name: s };
}

/** A sign-in that confirmed the email just now is the account's first: it lands on the welcome step. */
const FIRST_SIGN_IN_WINDOW_MS = 10 * 60_000;

export function landingAfterSignIn(user: { email_confirmed_at?: string | null } | null | undefined, now = Date.now()): string {
  const confirmed = Date.parse(user?.email_confirmed_at ?? "");
  // Either side of now: the auth server's clock may run a little ahead of this one.
  return Number.isFinite(confirmed) && Math.abs(now - confirmed) < FIRST_SIGN_IN_WINDOW_MS ? "/account?welcome=1" : "/";
}

/** Where to return after signing in, when sign-in interrupted something (approving a connected app, say). */
export const NEXT_COOKIE = "prism-next";

/** A same-site path to return to, or null — never another site, however it is dressed up. */
export function safeNext(x: unknown): string | null {
  if (typeof x !== "string" || x.length > 512 || !x.startsWith("/") || x.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(x)) return null;
  try {
    const url = new URL(x, "https://prism.invalid");
    const path = `${url.pathname}${url.search}`;
    // Only a path already in normal form: dot segments ("/.//evil.example")
    // normalise into "//evil.example", which a browser reads as another site.
    return url.origin === "https://prism.invalid" && path === x && !path.startsWith("//") ? path : null;
  } catch {
    return null;
  }
}
