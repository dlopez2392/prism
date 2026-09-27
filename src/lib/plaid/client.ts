// apps/finance/src/lib/plaid/client.ts
//
// A minimal, dependency-free Plaid client: JSON over HTTPS, server-only. The
// official SDK is a large generated package; this app uses seven endpoints,
// and owning the request shape keeps the error handling explicit.
//
// Configuration (all server-side, never NEXT_PUBLIC):
//   PLAID_CLIENT_ID, PLAID_SECRET   — from the Plaid dashboard
//   PLAID_ENV                       — "sandbox" (default) or "production"
//   PLAID_REDIRECT_URI              — optional; required for OAuth banks in production
//   PLAID_WEBHOOK_URL               — optional; SYNC_UPDATES_AVAILABLE lands here

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
  return { clientId, secret, env: which, host: HOSTS[which] };
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
): Promise<T> {
  const res = await fetchImpl(`${config.host}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Plaid-Version": "2020-09-14" },
    body: JSON.stringify({ client_id: config.clientId, secret: config.secret, ...body }),
    cache: "no-store",
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

export async function createLinkToken(config: PlaidConfig, clientUserId: string, env: Env = process.env) {
  const body: Record<string, unknown> = {
    user: { client_user_id: clientUserId },
    client_name: "Prism",
    language: "en",
    country_codes: ["US"],
    products: ["transactions"],
    // Asked for when the institution supports them; never blocks the link.
    optional_products: ["investments", "liabilities"],
    transactions: { days_requested: 730 },
  };
  if (env.PLAID_REDIRECT_URI) body.redirect_uri = env.PLAID_REDIRECT_URI;
  if (env.PLAID_WEBHOOK_URL) body.webhook = env.PLAID_WEBHOOK_URL;
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

/**
 * Pages /transactions/sync to the end. Without a stored cursor this replays
 * the Item's whole history every time — fine for the prototype's stateless
 * vault, and exactly what a persisted cursor removes in production.
 */
export async function syncAllTransactions(config: PlaidConfig, accessToken: string, fetchImpl?: typeof fetch) {
  let cursor: string | undefined;
  const added: PlaidTransaction[] = [];
  const removed = new Set<string>();
  let status = "COMPLETE";
  for (let page = 0; page < 40; page++) {
    const res = await plaidRequest<{
      added: PlaidTransaction[];
      modified: PlaidTransaction[];
      removed: { transaction_id: string }[];
      next_cursor: string;
      has_more: boolean;
      transactions_update_status?: string;
    }>(config, "/transactions/sync", { access_token: accessToken, cursor, count: 500 }, fetchImpl);
    added.push(...res.added, ...res.modified);
    for (const r of res.removed) removed.add(r.transaction_id);
    status = res.transactions_update_status ?? status;
    cursor = res.next_cursor;
    if (!res.has_more) break;
  }
  const latest = new Map<string, PlaidTransaction>();
  for (const t of added) if (!removed.has(t.transaction_id)) latest.set(t.transaction_id, t);
  return { transactions: [...latest.values()], ready: status !== "NOT_READY" };
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
