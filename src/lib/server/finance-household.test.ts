// The Household view through the loader: the switch picks it, my own shared
// accounts and each member's shared ones (opened from their SEALED copy, never
// a token) are all it shows, and the personal pages stay personal.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaidAccount, PlaidTransaction } from "@/lib/plaid/client";

vi.mock("server-only", () => ({}));
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined), has: (n: string) => jar.has(n) }), headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => ({ userId: "u-me", email: "me@x.test", supabase: {} }) }));

const KEY = randomBytes(32);
const month = new Date().toISOString().slice(0, 7);
const bank = (id: string, name: string, current: number): PlaidAccount => ({ account_id: id, name, official_name: null, mask: null, type: "depository", subtype: "checking", balances: { available: current, current, iso_currency_code: "USD" } });
const spend = (id: string, account: string, merchant: string, dollars: number): PlaidTransaction => ({ transaction_id: id, account_id: account, amount: dollars, date: `${month}-02`, name: merchant, merchant_name: merchant, pending: false, personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "x" } });
const copy = (accounts: PlaidAccount[], transactions: PlaidTransaction[]) => ({ v: 1, cursor: "c", ready: true, accounts, transactions });

const inHousehold = { current: true };
const shared = { mine: new Map<string, string | null>([["joint", "item-me"]]), fails: false };
vi.mock("./account-store", () => ({
  loadAccount: async () => ({
    firstName: "Dana",
    timeZone: "UTC",
    plan: { budgets: [{ category: "food", limit: 30_000 }], goals: null },
    categories: { v: 1, merchants: {}, transactions: {} },
    manual: [],
    inHousehold: inHousehold.current,
    items: [{ itemId: "item-me", accessToken: "access-me", institutionId: null, institutionName: "Northwind Bank", linkedAt: "2026-09-01" }],
    plaidSync: new Map([["item-me", { state: copy([bank("joint", "Joint Checking", 500), bank("private", "My Savings", 9000)], [spend("m1", "joint", "Corner Café", 12), spend("m2", "private", "Secret Gift", 80)]), version: 1, syncedAt: new Date().toISOString(), changedAt: null }]]),
    coinbase: null,
    feedUpdatedAt: null,
    reseal: null,
  }),
  liveCoinbaseToken: vi.fn(),
  saveAccountPlaidSync: vi.fn(),
  saveAccountTimeZone: vi.fn(),
  saveFeedSnapshot: vi.fn(),
}));
vi.mock("./household-store", async () => {
  const { sealPacked } = await import("./vault");
  return {
    loadShares: async () => shared.mine,
    loadSharedMoney: async () => {
      if (shared.fails) throw new Error("rpc failed");
      return [
        {
          userId: "u-sam",
          firstName: "Sam",
          sharedAccountIds: ["sam-card"],
          sealedCategoryRules: sealPacked({ v: 1, merchants: { "gas & go": "transport" }, transactions: {} }, KEY),
          sealedManualItems: null,
          items: [{ itemId: "item-sam", institutionName: "Summit Card", syncedAt: "2026-09-28T09:00:00Z", sealedSync: sealPacked(copy([bank("sam-card", "Rewards Visa", -300), bank("sam-private", "Sam's Savings", 50_000)], [spend("s1", "sam-card", "Gas & Go", 40), spend("s2", "sam-private", "Sam's secret", 99)]), KEY) }],
        },
      ];
    },
  };
});

describe("the Household view", () => {
  beforeEach(() => {
    jar.clear();
    inHousehold.current = true;
    shared.fails = false;
    vi.stubEnv("PLAID_CLIENT_ID", "id");
    vi.stubEnv("PLAID_SECRET", "secret");
    vi.stubEnv("PRISM_VAULT_KEY", KEY.toString("base64"));
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("shows what each member shared, whose it is, and nothing kept private", async () => {
    jar.set("prism-view", "household");
    const { getFinance } = await import("./finance");
    const data = await getFinance();
    expect(data.view).toBe("household");
    expect(data.accounts.map((a) => a.name).sort()).toEqual(["Joint Checking", "Rewards Visa"]);
    expect(data.institutions.map((i) => i.name).sort()).toEqual(["Northwind Bank · You", "Summit Card · Sam"]);
    const text = JSON.stringify(data.accounts) + JSON.stringify(data.transactions) + JSON.stringify(data.institutions);
    for (const secret of ["My Savings", "Secret Gift", "Sam's Savings", "Sam's secret", "access-"]) expect(text).not.toContain(secret);
    // Sam's own category fixes apply to Sam's shared transactions.
    expect(data.transactions.find((t) => t.merchant === "Gas & Go")).toMatchObject({ category: "transport", bankCategory: "food" });
    // Budgets are each person's own: none in the Household view, mine untouched in Me.
    expect(data.budgets).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("keeps the personal pages personal, whatever the switch says", async () => {
    jar.set("prism-view", "household");
    const { getPersonalFinance } = await import("./finance");
    const me = await getPersonalFinance();
    expect(me.view).toBe("me");
    expect(me.accounts.map((a) => a.name).sort()).toEqual(["Joint Checking", "My Savings"]);
    expect(me.budgets).toEqual([{ category: "food", limit: 30_000 }]);
  });

  it("is the person's own money on Me, even in a household", async () => {
    const { getFinance } = await import("./finance");
    const me = await getFinance();
    expect(me).toMatchObject({ view: "me", inHousehold: true });
    expect(me.accounts.map((a) => a.name).sort()).toEqual(["Joint Checking", "My Savings"]);
    jar.set("prism-view", "anything else");
    vi.resetModules();
    expect((await (await import("./finance")).getFinance()).view).toBe("me");
  });

  it("is the person's own money when they aren't in a household, or the household can't be read", async () => {
    jar.set("prism-view", "household");
    inHousehold.current = false;
    let { getFinance } = await import("./finance");
    expect((await getFinance()).view).toBe("me");
    vi.resetModules();
    inHousehold.current = true;
    shared.fails = true;
    ({ getFinance } = await import("./finance"));
    const data = await getFinance();
    expect(data.view).toBe("me");
    expect(data.notice).toMatch(/couldn't load your household/);
    expect(data.accounts.map((a) => a.name).sort()).toEqual(["Joint Checking", "My Savings"]);
  });
});
