// src/lib/plaid/link.ts
//
// Plaid Link in the browser, shared by the Connect button and by the page a
// bank's own sign-in sends people back to (/connections/return). Link loads
// from Plaid's CDN only when someone asks to connect; nothing third-party
// loads before that.

export type PlaidHandler = { open: () => void; destroy: () => void };
export type LinkSuccessMetadata = { institution?: { name?: string } | null };
export type LinkExitError = { display_message?: string | null; error_message?: string } | null;

export type PlaidLinkFactory = {
  create: (opts: {
    token: string;
    /** Back from a bank's own sign-in: this page's full address, Plaid's `oauth_state_id` and nothing else added. */
    receivedRedirectUri?: string;
    onSuccess: (publicToken: string, metadata: LinkSuccessMetadata) => void;
    onExit: (err: LinkExitError) => void;
  }) => PlaidHandler;
};

declare global {
  interface Window {
    Plaid?: PlaidLinkFactory;
  }
}

export const LINK_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

let loading: Promise<PlaidLinkFactory> | null = null;

/**
 * Plaid Link, loaded once. A load that fails (a blocker, a dropped network)
 * removes its script tag and forgets itself, so "Try again" really does try
 * again instead of waiting on events that have already fired.
 */
export function loadLink(): Promise<PlaidLinkFactory> {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  loading ??= new Promise<PlaidLinkFactory>((resolve, reject) => {
    for (const stale of document.querySelectorAll(`script[src="${LINK_SCRIPT}"]`)) stale.remove();
    const s = document.createElement("script");
    const fail = () => {
      s.remove();
      loading = null;
      reject(new Error("Plaid Link failed to load."));
    };
    s.addEventListener("load", () => (window.Plaid ? resolve(window.Plaid) : fail()));
    s.addEventListener("error", fail);
    s.src = LINK_SCRIPT;
    s.async = true;
    document.head.appendChild(s);
  });
  return loading;
}

/** `signIn`: the server wants a signed-in account first (src/lib/linking.ts), and the caller should send the person to sign in. */
export type SavedBank = { ok: true; institutionName: string | null } | { ok: false; message: string; signIn?: true };

/** Trade Link's one-time public token for a sealed access token, server-side. */
export async function saveBank(publicToken: string): Promise<SavedBank> {
  try {
    const res = await fetch("/api/plaid/exchange", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ publicToken }) });
    const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string; institutionName?: string | null };
    if (res.status === 401 && json.error === "sign_in_required") return { ok: false, message: json.message ?? "Sign in to connect a bank.", signIn: true };
    if (!res.ok) return { ok: false, message: json.message ?? "The bank linked, but we couldn't save it. Try again." };
    return { ok: true, institutionName: json.institutionName ?? null };
  } catch {
    return { ok: false, message: "The bank linked, but we couldn't reach Prism to save it. Check your connection and try again." };
  }
}
