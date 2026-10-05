// A person's splits, tags and who owes them reach their own lines wherever
// money is drawn: the screens, what a connected app is told, and the morning
// check's alert email, so a split bill counts in its parts everywhere.

import { describe, expect, it, vi } from "vitest";
import type { PlaidAccount, PlaidTransaction } from "@/lib/plaid/client";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, has: () => false }), headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => null }));

const checking: PlaidAccount = { account_id: "acc-1", name: "Checking", official_name: null, mask: "0001", type: "depository", subtype: "checking", balances: { available: 500, current: 500, iso_currency_code: "USD" } };
const line = (id: string, merchant: string, dollars: number): PlaidTransaction => ({
  transaction_id: id,
  account_id: "acc-1",
  amount: dollars,
  date: "2026-09-13",
  name: merchant,
  merchant_name: merchant,
  pending: false,
  personal_finance_category: { primary: "GENERAL_MERCHANDISE", detailed: "GENERAL_MERCHANDISE_SUPERSTORES" },
});

const SPLIT = { split: [{ category: "food", amount: 9_000 }, { category: "fun", amount: 6_000 }], tags: ["Party"], owed: { who: "Sam", amount: 5_000, paid: null } };

vi.mock("./account-store", () => ({
  loadAccount: async () => ({
    firstName: null,
    timeZone: "UTC",
    language: "en",
    plan: { budgets: null, goals: null },
    categories: { v: 1, merchants: {}, transactions: {} },
    manual: [],
    imports: [],
    lockedImports: [],
    wallets: [],
    p2pNotes: { v: 1, notes: {} },
    details: { v: 1, lines: { "t-costco": SPLIT } },
    items: [{ itemId: "item-1", accessToken: "access-sandbox-1", institutionId: null, institutionName: "First Bank", linkedAt: "2026-09-01" }],
    plaidSync: new Map([
      ["item-1", { state: { v: 1, cursor: "c-1", ready: true, accounts: [checking], transactions: [line("t-costco", "Costco", 150), line("t-other", "Target", 12)] }, version: 1, syncedAt: new Date().toISOString(), changedAt: null }],
    ]),
    coinbase: null,
    feedUpdatedAt: null,
    reseal: null,
  }),
  liveCoinbaseToken: vi.fn(),
  saveAccountPlaidSync: vi.fn(),
  saveAccountLanguage: vi.fn(async () => undefined),
  saveAccountTimeZone: vi.fn(),
  saveFeedSnapshot: vi.fn(),
}));

describe("splits, tags and who owes you", () => {
  it("reach the person's own line, split into its parts, in what a connected app is told and in the morning check", async () => {
    vi.stubEnv("PLAID_CLIENT_ID", "id");
    vi.stubEnv("PLAID_SECRET", "secret");
    vi.stubGlobal("fetch", vi.fn());
    const { agentFinance, morningFinance } = await import("./finance");
    const data = await agentFinance({ userId: "u1", email: "a@x.test", supabase: {} } as never);
    const by = Object.fromEntries(data.transactions.map((t) => [t.id, t]));
    expect(by["t-costco"]).toBeUndefined();
    expect(by["t-costco~1"]).toMatchObject({ amount: -9_000, category: "food", tags: ["Party"], owed: { who: "Sam" } });
    expect(by["t-costco~2"]).toMatchObject({ amount: -6_000, category: "fun", tags: ["Party"] });
    expect(by["t-costco~2"]!.owed).toBeUndefined();
    expect(by["t-other"]).toMatchObject({ amount: -1_200, category: "shopping" });
    expect(by["t-other"]!.tags).toBeUndefined();

    // The morning check counts the parts too, so an alert email agrees with the app.
    const morning = await morningFinance(
      {
        items: [{ itemId: "item-1", accessToken: "access-sandbox-1", institutionId: null, institutionName: "First Bank", linkedAt: "2026-09-01" }],
        plaidSync: { stored: new Map([["item-1", { state: { v: 1, cursor: "c-1", ready: true, accounts: [checking], transactions: [line("t-costco", "Costco", 150)] }, version: 1, syncedAt: new Date().toISOString(), changedAt: null }]]), save: null, clear: null, minimal: true },
        categories: { v: 1, merchants: {}, transactions: {} },
        manual: [],
        imports: [],
        wallets: { list: [], save: null, scan: null, offline: true },
        coinbase: null,
        details: { v: 1, lines: { "t-costco": SPLIT } },
      } as never,
      { budgets: null, goals: null },
      "2026-09-20",
    );
    expect(morning!.transactions.map((t) => [t.id, t.category, t.amount])).toEqual([
      ["t-costco~1", "food", -9_000],
      ["t-costco~2", "fun", -6_000],
    ]);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
