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
import { EN, type T } from "@/lib/i18n/t";

export type ConnectKind = "bank" | "investments" | "coinbase";

export type LinkingRefusal = {
  status: 401 | 503;
  error: "sign_in_required" | "accounts_required";
  message: string;
};

export function linkingRefusal(o: { accountsEnabled: boolean; signedIn: boolean; realMoney: boolean; kind?: ConnectKind }, t: T = EN): LinkingRefusal | null {
  if (o.signedIn) return null;
  // Whole sentences for each kind, so each language says "a bank" and "an investment account" its own way.
  if (o.accountsEnabled) {
    const message =
      o.kind === "coinbase"
        ? t("Sign in to connect Coinbase. It's kept in your account, where two-step sign-in protects it.")
        : o.kind === "investments"
          ? t("Sign in to connect an investment account. It's kept in your account, where two-step sign-in protects it.")
          : t("Sign in to connect a bank. It's kept in your account, where two-step sign-in protects it.");
    return { status: 401, error: "sign_in_required", message };
  }
  if (o.realMoney) {
    const message =
      o.kind === "coinbase"
        ? t("Connecting Coinbase needs a Prism account, and accounts aren't set up on this site.")
        : o.kind === "investments"
          ? t("Connecting an investment account needs a Prism account, and accounts aren't set up on this site.")
          : t("Connecting a bank needs a Prism account, and accounts aren't set up on this site.");
    return { status: 503, error: "accounts_required", message };
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
  return why === "bank" || why === "investments" || why === "coinbase" ? why : null;
}
