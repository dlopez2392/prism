// Plaid's warnings about a bank (plaid_bank_warning) on the person's own
// screens (finance.ts): a consent running out shows its date and stays until
// they sign in again; a sign-in or a withdrawal shows at once, and ends when
// Plaid answers again — never on a stored copy served without asking, and
// never written by a connected app.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaidAccount } from "@/lib/plaid/client";
import type { BankAttention } from "./vault";

vi.mock("server-only", () => ({}));
const scheduled: (() => unknown)[] = [];
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (fn: () => unknown) => void scheduled.push(fn) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, has: () => false }), headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => ({ userId: "u1", email: "a@x.test", supabase: {} }) }));

const savings: PlaidAccount = { account_id: "sav", name: "Savings", official_name: null, mask: "0002", type: "depository", subtype: "savings", balances: { available: 800, current: 800, iso_currency_code: "USD" } };
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const bank = { attention: undefined as BankAttention | undefined, syncedAt: ago(2 * 3_600_000) };
const clearBankAttention = vi.fn(async () => undefined);
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
    items: [{ itemId: "item-1", accessToken: "access-production-1", institutionId: null, institutionName: "First Bank", linkedAt: "2026-09-30", ...(bank.attention ? { attention: bank.attention } : {}) }],
    plaidSync: new Map([["item-1", { state: { v: 1, cursor: "c-1", ready: true, accounts: [savings], transactions: [] }, version: 3, syncedAt: bank.syncedAt, changedAt: null }]]),
    coinbase: null,
    feedUpdatedAt: new Date().toISOString(),
    reseal: null,
  }),
  clearBankAttention,
  liveCoinbaseToken: vi.fn(),
  saveAccountPlaidSync: vi.fn(async () => true),
  saveAccountTimeZone: vi.fn(),
  saveFeedSnapshot: vi.fn(async () => undefined),
  saveCoinbaseValue: vi.fn(),
  saveWalletReadings: vi.fn(),
}));

/** Plaid answering, or refusing every call with ITEM_LOGIN_REQUIRED. */
const plaid = { refuse: false };
const fetchPlaid = vi.fn(async (url: RequestInfo | URL) => {
  if (plaid.refuse) return Response.json({ error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "…", display_message: null }, { status: 400 });
  const path = new URL(String(url)).pathname;
  if (path === "/accounts/get") return Response.json({ accounts: [savings], item: { institution_id: null } });
  if (path === "/transactions/sync") return Response.json({ added: [], modified: [], removed: [], next_cursor: "c-2", has_more: false, transactions_update_status: "HISTORICAL_UPDATE_COMPLETE" });
  return Response.json({ error_code: "NOT_FOUND" }, { status: 404 });
});

async function ownVisit() {
  vi.resetModules();
  const { getPersonalFinance } = await import("./finance");
  const data = await getPersonalFinance();
  for (const fn of scheduled.splice(0)) await fn();
  return data;
}
async function connectedApp() {
  vi.resetModules();
  const { agentFinance } = await import("./finance");
  const data = await agentFinance({ userId: "u1", email: "a@x.test", supabase: {} } as never);
  for (const fn of scheduled.splice(0)) await fn();
  return data;
}

describe("Plaid's warnings about a bank", () => {
  beforeEach(() => {
    vi.stubEnv("PLAID_CLIENT_ID", "id");
    vi.stubEnv("PLAID_SECRET", "secret");
    vi.stubEnv("PRISM_VAULT_KEY", randomBytes(32).toString("base64"));
    vi.stubGlobal("fetch", fetchPlaid);
    Object.assign(bank, { attention: undefined, syncedAt: ago(2 * 3_600_000) });
    plaid.refuse = false;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchPlaid.mockClear();
    clearBankAttention.mockClear();
    scheduled.length = 0;
  });

  it("shows when a bank's consent runs out, and keeps that until its owner signs in again, even though it still syncs", async () => {
    bank.attention = { state: "disconnecting", disconnectAt: "2026-10-08T13:25:17.766Z" };
    const [inst] = (await ownVisit()).institutions;
    expect(inst).toMatchObject({ id: "item-1", health: "healthy", disconnectsAt: "2026-10-08T13:25:17.766Z" });
    expect(inst).not.toHaveProperty("signInAgain");
    expect(fetchPlaid).toHaveBeenCalled();
    expect(clearBankAttention).not.toHaveBeenCalled();
  });

  it("asks for a sign-in at once, and ends the warning when Plaid answers again", async () => {
    bank.attention = { state: "sign-in", disconnectAt: null };
    // A fresh copy is served without asking Plaid: no proof the sign-in works, so the warning stands.
    bank.syncedAt = ago(60_000);
    let data = await ownVisit();
    expect(fetchPlaid).not.toHaveBeenCalled();
    expect(data.institutions[0]).toMatchObject({ health: "needs_attention", signInAgain: true });
    expect(data.notice).toBe("First Bank needs you to sign in again — showing it as of the last sync.");
    expect(clearBankAttention).not.toHaveBeenCalled();

    // Once Plaid has answered, it's over: no sign-in shown, and the warning is cleared after the response.
    bank.syncedAt = ago(2 * 3_600_000);
    data = await ownVisit();
    expect(data.institutions[0]).toMatchObject({ health: "healthy" });
    expect(data.institutions[0]).not.toHaveProperty("signInAgain");
    expect(clearBankAttention).toHaveBeenCalledWith({ userId: "u1", email: "a@x.test", supabase: {} }, "item-1", { only: ["sign-in", "revoked"] });
  });

  it("keeps a withdrawal while Plaid still refuses", async () => {
    bank.attention = { state: "revoked", disconnectAt: null };
    plaid.refuse = true;
    const data = await ownVisit();
    expect(data.institutions[0]).toMatchObject({ signInAgain: true });
    expect(clearBankAttention).not.toHaveBeenCalled();
  });

  it("is never written by a connected app, which only reads", async () => {
    bank.attention = { state: "sign-in", disconnectAt: null };
    const data = await connectedApp();
    expect(fetchPlaid).toHaveBeenCalled();
    expect(data.institutions[0]).not.toHaveProperty("signInAgain");
    expect(clearBankAttention).not.toHaveBeenCalled();
  });
});
