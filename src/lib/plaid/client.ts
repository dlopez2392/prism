// src/lib/plaid/client.ts
//
// A minimal, dependency-free Plaid client: JSON over HTTPS, server-only. The
// official SDK is a large generated package; this app uses seven endpoints,
// and owning the request shape keeps the error handling explicit.
//
// Configuration (all server-side, never NEXT_PUBLIC):
//   PLAID_CLIENT_ID, PLAID_SECRET   — from the Plaid dashboard
//   PLAID_ENV                       — "sandbox" (default) or "production"
//   PLAID_REDIRECT_URI              — optional; required for OAuth banks in production
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

/** `webhookUrl` is where Plaid announces new transactions; PLAID_WEBHOOK_URL overrides it. */
export async function createLinkToken(config: PlaidConfig, clientUserId: string, webhookUrl: string | null = null, env: Env = process.env) {
  const body: Record<string, unknown> = {
    user: { client_user_id: clientUserId },
    // The name Plaid Link shows: "Prism uses Plaid to connect your account".
    client_name: BRAND.product,
    language: "en",
    country_codes: ["US"],
    products: ["transactions"],
    // Asked for when the institution supports them; never blocks the link.
    optional_products: ["investments", "liabilities"],
    transactions: { days_requested: 730 },
  };
  if (env.PLAID_REDIRECT_URI) body.redirect_uri = env.PLAID_REDIRECT_URI;
  const webhook = env.PLAID_WEBHOOK_URL?.trim() || webhookUrl;
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
