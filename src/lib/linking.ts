// src/lib/linking.ts
//
// Who may connect real money. With accounts on (always, in production), a
// bank or Coinbase connects only to a signed-in account, because that's where
// two-step sign-in protects the connection, "Delete account" removes it, and
// the retention policy reaches it. A connection kept only in one browser's
// cookie gets none of that.
//
// With accounts off (a laptop with no Supabase settings), Plaid's SANDBOX
// still links into the device cookie so Prism can be developed and tried.
// Anything real (Plaid production, Coinbase) never does.
//
// No server-only imports: the Connect button builds the same sign-in link.

import { safeNext } from "@/lib/profile";

export type ConnectKind = "bank" | "coinbase";

export type LinkingRefusal = {
  status: 401 | 503;
  error: "sign_in_required" | "accounts_required";
  message: string;
};

export function linkingRefusal(o: { accountsEnabled: boolean; signedIn: boolean; realMoney: boolean; kind?: ConnectKind }): LinkingRefusal | null {
  if (o.signedIn) return null;
  const what = o.kind === "coinbase" ? "Coinbase" : "a bank";
  if (o.accountsEnabled) {
    return { status: 401, error: "sign_in_required", message: `Sign in to connect ${what}. It's kept in your account, where two-step sign-in protects it.` };
  }
  if (o.realMoney) {
    return { status: 503, error: "accounts_required", message: `Connecting ${what} needs a Prism account, and accounts aren't set up on this site.` };
  }
  return null;
}

/** Where to send someone who has to sign in first, returning to `back` afterwards. */
export function signInToConnect(kind: ConnectKind, back: unknown): string {
  const next = safeNext(back);
  const q = new URLSearchParams({ why: kind });
  if (next) q.set("next", next);
  return `/sign-in?${q.toString()}`;
}

/** The sign-in page's reason to show, from its `why` parameter. Anything else is ignored. */
export function connectReason(why: unknown): ConnectKind | null {
  return why === "bank" || why === "coinbase" ? why : null;
}
