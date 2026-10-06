// Once someone's Prism Plus ends: the first connection they made keeps
// updating, the others show what they last said and are never asked again
// (so neither a free plan nor a lapsed one costs a bank call beyond the
// first), and Coinbase rests. Nothing is deleted: it all comes back with Plus.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaidAccount } from "@/lib/plaid/client";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: () => undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, has: () => false }), headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => ({ userId: "u1", email: "a@x.test", supabase: {} }) }));
const plus = { current: false };
vi.mock("@/lib/billing/plus", () => ({ plusFor: async () => ({ billing: true, checked: true, plus: plus.current, householdView: plus.current }) }));

const account = (id: string, name: string, balance: number): PlaidAccount => ({
  account_id: id,
  name,
  official_name: null,
  mask: "0001",
  type: "depository",
  subtype: "checking",
  balances: { available: balance, current: balance, iso_currency_code: "USD" },
});
const LAST = "2026-09-20T12:00:00.000Z";
const liveCoinbaseToken = vi.fn(async () => "cb-token");
vi.mock("./account-store", () => ({
  loadAccount: async () => ({
    firstName: null,
    timeZone: "UTC",
    language: "en",
    plan: { budgets: null, goals: null },
    categories: { v: 1, merchants: {}, transactions: {} },
    manual: [],
    homeValues: [],
    imports: [],
    lockedImports: [],
    wallets: [],
    inHousehold: false,
    coinbaseShared: null,
    // Listed newest first: the one kept up to date is the first ever made, wherever it's listed.
    items: [
      { itemId: "item-new", accessToken: "access-production-new", institutionId: null, institutionName: "Second Bank", linkedAt: "2026-10-01" },
      { itemId: "item-old", accessToken: "access-production-old", institutionId: null, institutionName: "First Bank", linkedAt: "2026-09-01" },
    ],
    plaidSync: new Map([
      ["item-new", { state: { v: 1, cursor: "c-2", ready: true, accounts: [account("new-chk", "Second checking", 300)], transactions: [] }, version: 1, syncedAt: LAST, changedAt: "2026-10-05T00:00:00Z" }],
      ["item-old", { state: { v: 1, cursor: "c-1", ready: true, accounts: [account("old-chk", "First checking", 100)], transactions: [] }, version: 1, syncedAt: LAST, changedAt: "2026-10-05T00:00:00Z" }],
    ]),
    coinbase: { tokens: { accessToken: "cb", refreshToken: "cb-r", expiresAt: Date.now() + 3_600_000 }, version: 1, linkedAt: "2026-09-15" },
    feedUpdatedAt: null,
    alerts: null,
    reseal: null,
  }),
  liveCoinbaseToken,
  clearBankAttention: vi.fn(),
  saveAccountPlaidSync: vi.fn(async () => true),
  saveAccountLanguage: vi.fn(async () => undefined),
  saveAccountTimeZone: vi.fn(),
  saveFeedSnapshot: vi.fn(),
  saveCoinbaseValue: vi.fn(),
  saveWalletReadings: vi.fn(),
}));

/** Plaid answering for whichever bank's token it's asked with; Coinbase answering with nothing held. */
const banks = vi.fn<typeof fetch>(async (url, init) => {
  const u = new URL(String(url));
  if (u.hostname.includes("coinbase")) return Response.json({ data: [], pagination: {} });
  const token = (JSON.parse(String(init?.body)) as { access_token?: string }).access_token;
  const balance = token === "access-production-old" ? 150 : 999;
  if (u.pathname === "/accounts/get") return Response.json({ accounts: [account(token === "access-production-old" ? "old-chk" : "new-chk", "Checking", balance)], item: {} });
  if (u.pathname === "/transactions/sync") return Response.json({ added: [], modified: [], removed: [], next_cursor: "c-9", has_more: false });
  return Response.json({ error_code: "NOT_FOUND" }, { status: 404 });
});

async function ownVisit() {
  vi.resetModules();
  const { getPersonalFinance } = await import("./finance");
  return getPersonalFinance();
}
const asked = () => banks.mock.calls.filter(([u]) => !String(u).includes("coinbase")).map(([, init]) => (JSON.parse(String(init?.body)) as { access_token?: string }).access_token);

describe("once Prism Plus ends", () => {
  beforeEach(() => {
    vi.stubEnv("PLAID_CLIENT_ID", "id");
    vi.stubEnv("PLAID_SECRET", "secret");
    vi.stubEnv("PRISM_VAULT_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("COINBASE_CLIENT_ID", "cb-id");
    vi.stubEnv("COINBASE_CLIENT_SECRET", "cb-secret");
    banks.mockClear();
    liveCoinbaseToken.mockClear();
    vi.stubGlobal("fetch", banks);
    plus.current = false;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps the first bank up to date and shows the rest as they last were, without asking their bank", async () => {
    const data = await ownVisit();
    expect([...new Set(asked())]).toEqual(["access-production-old"]);
    expect(Object.fromEntries(data.accounts.filter((a) => a.source === "plaid").map((a) => [a.id, a.balance]))).toEqual({ "old-chk": 15_000, "new-chk": 30_000 });
    expect(data.institutions.find((i) => i.id === "item-new")).toEqual({ id: "item-new", name: "Second Bank", health: "healthy", paused: true, lastSyncedAt: LAST, source: "plaid" });
    expect(data.institutions.find((i) => i.id === "item-old")).not.toHaveProperty("paused");
    // Pausing is no problem to fix: no "Fix it" banner for it.
    expect(data.notice).toBeNull();
  });

  it("rests Coinbase: still listed, so it can be disconnected, but never asked and counted nowhere", async () => {
    const data = await ownVisit();
    expect(liveCoinbaseToken).not.toHaveBeenCalled();
    expect(data.institutions.find((i) => i.source === "coinbase")).toMatchObject({ paused: true, health: "healthy" });
    expect(data.accounts.some((a) => a.source === "coinbase")).toBe(false);
  });

  it("brings everything back with Plus", async () => {
    plus.current = true;
    const data = await ownVisit();
    expect([...new Set(asked())].sort()).toEqual(["access-production-new", "access-production-old"]);
    expect(data.institutions.some((i) => i.paused)).toBe(false);
    expect(liveCoinbaseToken).toHaveBeenCalled();
  });
});
