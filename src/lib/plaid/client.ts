// src/lib/plaid/client.ts
//
// A minimal, dependency-free Plaid client: JSON over HTTPS, server-only. The
// official SDK is a large generated package; this app uses seven endpoints,
// and owning the request shape keeps the error handling explicit.
//
// Configuration (all server-side, never NEXT_PUBLIC):
//   PLAID_CLIENT_ID, PLAID_SECRET   — from the Plaid dashboard
//   PLAID_ENV                       — "sandbox" (default) or "production"
//   PLAID_REDIRECT_URI              — optional; <this site>/connections/return, once it's on
//                                     Plaid's allow-list (see redirectUriFor)
//   PLAID_WEBHOOK_URL               — optional; defaults to this site's /api/plaid/webhook
//   PLAID_API_URL                   — TEST HOOK, sandbox only: point at a fake Plaid

import { BRAND } from "@/lib/brand";

/** Just the variables read here — a plain record, so tests can pass one. */
export type Env = Record<string, string | undefined>;

export type PlaidEnv = "sandbox" | "production";

export type PlaidConfig = { clientId: string; secret: string; env: PlaidEnv; host: string };

const HOSTS: Record<PlaidEnv, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

export function plaidConfig(env: Env = process.env): PlaidConfig | null {
  const clientId = env.PLAID_CLIENT_ID?.trim();
  const secret = env.PLAID_SECRET?.trim();
  if (!clientId || !secret) return null;
  const which: PlaidEnv = env.PLAID_ENV?.trim() === "production" ? "production" : "sandbox";
  // Tests may stand a fake Plaid in for the sandbox; production always talks to Plaid.
  const fake = which === "sandbox" ? env.PLAID_API_URL?.trim().replace(/\/+$/, "") : "";
  return { clientId, secret, env: which, host: fake || HOSTS[which] };
}

export class PlaidError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** Plaid's end-user-safe message, when it sends one. */
    readonly displayMessage: string | null,
    message: string,
  ) {
    super(message);
    this.name = "PlaidError";
  }
}

export async function plaidRequest<T>(
  config: PlaidConfig,
  path: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  // A hung Plaid call must not hang a page (or a webhook) with it.
  timeoutMs = 30_000,
): Promise<T> {
  const res = await fetchImpl(`${config.host}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Plaid-Version": "2020-09-14" },
    body: JSON.stringify({ client_id: config.clientId, secret: config.secret, ...body }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new PlaidError(
      res.status,
      String(json.error_code ?? "UNKNOWN"),
      typeof json.display_message === "string" ? json.display_message : null,
      `Plaid ${path} failed: ${String(json.error_code ?? res.status)} ${String(json.error_message ?? "")}`.trim(),
    );
  }
  return json as T;
}

// ── The endpoints this app uses ──────────────────────────────────────────────

export type PlaidAccount = {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: "depository" | "credit" | "investment" | "loan" | "brokerage" | "other";
  subtype: string | null;
  balances: { available: number | null; current: number | null; iso_currency_code: string | null };
};

export type PlaidTransaction = {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  name: string;
  merchant_name?: string | null;
  pending: boolean;
  personal_finance_category?: { primary: string; detailed: string } | null;
};

export type PlaidHolding = {
  account_id: string;
  security_id: string;
  institution_value: number;
  cost_basis: number | null;
  quantity: number;
};

export type PlaidSecurity = {
  security_id: string;
  ticker_symbol: string | null;
  name: string | null;
  type: string | null;
};

/** The page a bank that signs people in on its own website sends them back to (src/app/connections/return). */
export const RETURN_PATH = "/connections/return";

/**
 * The redirect URI to give Plaid for this request, or null — with the reason
 * when the setting is wrong rather than merely absent.
 *
 * Plaid refuses to create a Link token whose redirect URI isn't on the
 * dashboard's allow-list, so nothing is sent until the operator sets
 * PLAID_REDIRECT_URI, which they do after allow-listing it. Even then it is
 * sent only when it is exactly this site's return page, in a form Plaid
 * accepts: HTTPS (plain http for localhost, sandbox only), and no query,
 * fragment or trailing slash. The page resumes with `window.location.href`,
 * which must equal this URI plus Plaid's `oauth_state_id`. A request reaching
 * Prism on another hostname gets none: the return would land where this
 * browser's cookies aren't. Without one, the bank's site opens in a pop-up,
 * which is how desktop browsers already work.
 */
export function redirectUriFor(env: Env, origin: string, plaidEnv: PlaidEnv): { uri: string | null; problem: string | null } {
  const raw = env.PLAID_REDIRECT_URI?.trim();
  if (!raw) return { uri: null, problem: null };
  const expected = `must be exactly ${origin}${RETURN_PATH}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { uri: null, problem: `PLAID_REDIRECT_URI isn't a URL; it ${expected}` };
  }
  const localSandbox = url.protocol === "http:" && plaidEnv === "sandbox" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localSandbox) return { uri: null, problem: `PLAID_REDIRECT_URI must use https; it ${expected}` };
  if (/[?#]/.test(raw) || url.href !== raw || url.username || url.password || url.pathname !== RETURN_PATH) {
    return { uri: null, problem: `PLAID_REDIRECT_URI ${expected}` };
  }
  if (url.origin !== origin) return { uri: null, problem: `PLAID_REDIRECT_URI points at ${url.origin}, so it is left out for requests to ${origin}` };
  return { uri: url.href, problem: null };
}

/**
 * What Link asks for. Every one of these READS: the Terms of Service promise
 * that Prism can never move money, and terms.test.ts holds these to a
 * read-only list. A product that could pay, transfer or verify identity is a
 * change to the Terms and the privacy policy first.
 */
export const LINK_PRODUCTS = ["transactions"] as const;
/** Fetched when the bank supports it, and billed from the moment a bank links: only what Prism reads today. */
export const LINK_OPTIONAL_PRODUCTS = ["investments"] as const;
/**
 * Consent only: Plaid asks the person's permission at link time, fetches
 * nothing, and bills nothing until Prism first calls the product. So a later
 * feature (a card's due date and minimum payment, say) needs no re-linking,
 * and nobody pays for, or hands over, data Prism doesn't use yet.
 */
export const LINK_CONSENTED_PRODUCTS = ["liabilities"] as const;
/** The Terms say accounts are for people in the United States. */
export const LINK_COUNTRIES = ["US"] as const;

/**
 * `webhookUrl` is where Plaid announces new transactions (PLAID_WEBHOOK_URL
 * overrides it); `redirectUri` is where a bank's own sign-in page sends the
 * person back (see redirectUriFor).
 */
export async function createLinkToken(
  config: PlaidConfig,
  clientUserId: string,
  opts: { webhookUrl?: string | null; redirectUri?: string | null } = {},
  env: Env = process.env,
) {
  const body: Record<string, unknown> = {
    user: { client_user_id: clientUserId },
    // The name Plaid Link shows: "Prism uses Plaid to connect your account".
    client_name: BRAND.product,
    language: "en",
    country_codes: [...LINK_COUNTRIES],
    products: [...LINK_PRODUCTS],
    // Asked for when the institution supports them; never blocks the link.
    optional_products: [...LINK_OPTIONAL_PRODUCTS],
    additional_consented_products: [...LINK_CONSENTED_PRODUCTS],
    transactions: { days_requested: 730 },
  };
  if (opts.redirectUri) body.redirect_uri = opts.redirectUri;
  const webhook = env.PLAID_WEBHOOK_URL?.trim() || opts.webhookUrl;
  if (webhook) body.webhook = webhook;
  return plaidRequest<{ link_token: string; expiration: string }>(config, "/link/token/create", body);
}

export async function exchangePublicToken(config: PlaidConfig, publicToken: string) {
  return plaidRequest<{ access_token: string; item_id: string }>(config, "/item/public_token/exchange", {
    public_token: publicToken,
  });
}

export async function getAccounts(config: PlaidConfig, accessToken: string) {
  return plaidRequest<{ accounts: PlaidAccount[]; item: { institution_id: string | null } }>(config, "/accounts/get", {
    access_token: accessToken,
  });
}

export async function getHoldings(config: PlaidConfig, accessToken: string) {
  return plaidRequest<{ holdings: PlaidHolding[]; securities: PlaidSecurity[] }>(config, "/investments/holdings/get", {
    access_token: accessToken,
  });
}

export async function getInstitutionName(config: PlaidConfig, institutionId: string): Promise<string | null> {
  try {
    const res = await plaidRequest<{ institution: { name: string } }>(config, "/institutions/get_by_id", {
      institution_id: institutionId,
      country_codes: ["US"],
    });
    return res.institution.name;
  } catch {
    return null;
  }
}

export async function removeItem(config: PlaidConfig, accessToken: string) {
  return plaidRequest<{ request_id: string }>(config, "/item/remove", { access_token: accessToken });
}
