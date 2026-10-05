// An investment account connected on its own (a brokerage such as Robinhood
// or Webull, linked holdings first: LinkKind in plaid/client.ts) in the
// person's own finances (finance.ts). Plaid has no transactions to give for
// it, and may refuse to be asked: that refusal is the answer, never an
// outage, while anything else going wrong still says so.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaidAccount } from "@/lib/plaid/client";

vi.mock("server-only", () => ({}));
const scheduled: (() => unknown)[] = [];
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (fn: () => unknown) => void scheduled.push(fn) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, has: () => false }), headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => ({ userId: "u1", email: "a@x.test", supabase: {} }) }));

const account = (id: string, type: PlaidAccount["type"], subtype: string | null, current: number): PlaidAccount => ({
  account_id: id,
  name: id,
  official_name: null,
  mask: "0001",
  type,
  subtype,
  balances: { available: null, current, iso_currency_code: "USD" },
});
const brokerage = account("brk", "investment", "brokerage", 12_500);
const checking = account("chk", "depository", "checking", 2_000);

/** The one linked connection's accounts, and how Plaid answers each question about it. */
const bank = { accounts: [brokerage] as PlaidAccount[], transactions: "refused" as "refused" | "ok" | "down", accountsAnswer: "ok" as "ok" | "sign-in" };
const saveAccountPlaidSync = vi.fn(async () => true);
vi.mock("./account-store", () => ({
  loadAccount: async () => ({
    firstName: "Dana",
    timeZone: "UTC",
    plan: { budgets: null, goals: null },
    categories: { v: 1, merchants: {}, transactions: {} },
    manual: [],
    imports: [],
    lockedImports: [],
    wallets: [],
    inHousehold: false,
    coinbaseShared: null,
    items: [{ itemId: "item-1", accessToken: "access-production-1", institutionId: null, institutionName: "Robinhood", linkedAt: "2026-10-05" }],
    // Just linked: nothing stored yet, so this visit asks Plaid.
    plaidSync: new Map(),
    coinbase: null,
    feedUpdatedAt: new Date().toISOString(),
    reseal: null,
  }),
  liveCoinbaseToken: vi.fn(),
  saveAccountPlaidSync,
  saveAccountTimeZone: vi.fn(),
  saveFeedSnapshot: vi.fn(async () => undefined),
  saveCoinbaseValue: vi.fn(),
}));

const refused = (code: string, status = 400) => Response.json({ error_type: "ITEM_ERROR", error_code: code, error_message: code }, { status });
const fetchPlaid = vi.fn(async (url: RequestInfo | URL) => {
  const path = new URL(String(url)).pathname;
  if (path === "/accounts/get") return bank.accountsAnswer === "sign-in" ? refused("ITEM_LOGIN_REQUIRED") : Response.json({ accounts: bank.accounts, item: { institution_id: null } });
  if (path === "/transactions/sync") {
    if (bank.transactions === "refused") return refused("PRODUCTS_NOT_SUPPORTED");
    if (bank.transactions === "down") return refused("INSTITUTION_DOWN");
    return Response.json({ added: [], modified: [], removed: [], next_cursor: "c-1", has_more: false, transactions_update_status: "HISTORICAL_UPDATE_COMPLETE" });
  }
  if (path === "/investments/holdings/get") {
    return Response.json({
      holdings: [{ account_id: "brk", security_id: "sec-vti", quantity: 40, institution_value: 12_000, institution_price: 300, cost_basis: 9_000, iso_currency_code: "USD" }],
      securities: [{ security_id: "sec-vti", name: "Vanguard Total Stock Market ETF", ticker_symbol: "VTI", type: "etf", close_price: 300, iso_currency_code: "USD" }],
    });
  }
  return Response.json({ error_code: "NOT_FOUND" }, { status: 404 });
});

async function ownVisit() {
  vi.resetModules();
  const { getPersonalFinance } = await import("./finance");
  const data = await getPersonalFinance();
  for (const fn of scheduled.splice(0)) await fn();
  return data;
}
const savedState = () => (saveAccountPlaidSync.mock.calls.at(-1) as unknown[] | undefined)?.[2] as { transactions: unknown[]; ready: boolean; accounts: PlaidAccount[] } | undefined;

describe("an investment account connected on its own", () => {
  beforeEach(() => {
    vi.stubEnv("PLAID_CLIENT_ID", "id");
    vi.stubEnv("PLAID_SECRET", "secret");
    vi.stubEnv("PRISM_VAULT_KEY", randomBytes(32).toString("base64"));
    vi.stubGlobal("fetch", fetchPlaid);
    Object.assign(bank, { accounts: [brokerage], transactions: "refused", accountsAnswer: "ok" });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchPlaid.mockClear();
    saveAccountPlaidSync.mockClear();
    scheduled.length = 0;
  });

  it("shows its balance and holdings, healthy, when Plaid has no transactions to give for it", async () => {
    const data = await ownVisit();
    expect(data.source).toBe("plaid");
    expect(data.institutions).toEqual([expect.objectContaining({ id: "item-1", name: "Robinhood", health: "healthy" })]);
    expect(data.notice).toBeNull();
    expect(data.accounts.find((a) => a.id === "brk")).toMatchObject({ balance: 1_250_000 });
    expect(data.holdings).toEqual([expect.objectContaining({ symbol: "VTI" })]);
    // Kept like any bank's copy, ready, so the next visit within the quarter hour asks Plaid nothing.
    expect(savedState()).toMatchObject({ transactions: [], ready: true, accounts: [expect.objectContaining({ account_id: "brk" })] });
  });

  it("is the same when Plaid simply has none: an empty answer and a refusal mean the same thing here", async () => {
    bank.transactions = "ok";
    const data = await ownVisit();
    expect(data.institutions).toEqual([expect.objectContaining({ health: "healthy" })]);
    expect(data.holdings).toHaveLength(1);
  });

  it("still says so when it needs signing in to again, whatever its transactions do", async () => {
    bank.accountsAnswer = "sign-in";
    const data = await ownVisit();
    expect(data.institutions).toEqual([expect.objectContaining({ health: "needs_attention", signInAgain: true })]);
    expect(data.notice).toMatch(/Robinhood needs you to sign in again/);
  });

  it("is never an excuse for a bank: one whose transactions are refused still couldn't be reached", async () => {
    bank.accounts = [checking, brokerage];
    bank.transactions = "down";
    const data = await ownVisit();
    expect(data.institutions).toEqual([expect.objectContaining({ health: "needs_attention" })]);
    expect(data.notice).toMatch(/couldn't reach Robinhood/);
    expect(saveAccountPlaidSync).not.toHaveBeenCalled();
  });
});
