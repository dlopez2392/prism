// A person's category fixes reach everything built from their bank's
// transactions: the transactions themselves, the budgets Prism drafts from
// them, and what a connected app (Claude, ChatGPT) is told.

import { describe, expect, it, vi } from "vitest";
import type { PlaidAccount, PlaidTransaction } from "@/lib/plaid/client";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, has: () => false }), headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => null }));

/** A day in last month, so it counts toward the budgets Prism drafts from the last three full months. */
const lastMonth = (() => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 12)).toISOString().slice(0, 10);
})();
const checking: PlaidAccount = { account_id: "acc-1", name: "Checking", official_name: null, mask: "0001", type: "depository", subtype: "checking", balances: { available: 500, current: 500, iso_currency_code: "USD" } };
const spend = (id: string, merchant: string, dollars: number, primary: string): PlaidTransaction => ({
  transaction_id: id,
  account_id: "acc-1",
  amount: dollars,
  date: lastMonth,
  name: merchant,
  merchant_name: merchant,
  pending: false,
  personal_finance_category: { primary, detailed: primary },
});

vi.mock("./account-store", () => ({
  loadAccount: async () => ({
    firstName: null,
    timeZone: "UTC",
    plan: { budgets: null, goals: null },
    // "Blue Bottle is food, not shopping" — and one bank transfer the person says is really rent.
    categories: { v: 1, merchants: { "blue bottle": "food" }, transactions: { "t-rent": "housing" } },
    manual: [],
    imports: [],
    lockedImports: [],
    wallets: [],
    items: [{ itemId: "item-1", accessToken: "access-sandbox-1", institutionId: null, institutionName: "First Bank", linkedAt: "2026-09-01" }],
    plaidSync: new Map([
      [
        "item-1",
        {
          state: {
            v: 1,
            cursor: "c-1",
            ready: true,
            accounts: [checking],
            transactions: [spend("t-1", "Blue Bottle", 6, "GENERAL_MERCHANDISE"), spend("t-2", "Blue Bottle", 9, "GENERAL_MERCHANDISE"), spend("t-rent", "Zelle to J. Smith", 1400, "TRANSFER_OUT")],
          },
          version: 1,
          syncedAt: new Date().toISOString(),
          changedAt: null,
        },
      ],
    ]),
    coinbase: null,
    feedUpdatedAt: null,
    reseal: null,
  }),
  liveCoinbaseToken: vi.fn(),
  saveAccountPlaidSync: vi.fn(),
  saveAccountTimeZone: vi.fn(),
  saveFeedSnapshot: vi.fn(),
}));

describe("category fixes", () => {
  it("reach the transactions, the drafted budgets and a connected app's answers, from the stored copy alone", async () => {
    vi.stubEnv("PLAID_CLIENT_ID", "id");
    vi.stubEnv("PLAID_SECRET", "secret");
    const plaid = vi.fn();
    vi.stubGlobal("fetch", plaid);
    const { agentFinance } = await import("./finance");
    const data = await agentFinance({ userId: "u1", email: "a@x.test", supabase: {} } as never);

    expect(data.demo).toBe(false);
    const by = Object.fromEntries(data.transactions.map((t) => [t.id, t]));
    expect(by["t-1"]).toMatchObject({ category: "food", bankCategory: "shopping" });
    expect(by["t-2"]).toMatchObject({ category: "food", bankCategory: "shopping" });
    expect(by["t-rent"]).toMatchObject({ category: "housing", bankCategory: "transfer" });
    // Drafted from the corrected month: food and housing, and no shopping at all.
    expect(data.budgets.map((b) => b.category).sort()).toEqual(["food", "housing"]);
    expect(plaid).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
