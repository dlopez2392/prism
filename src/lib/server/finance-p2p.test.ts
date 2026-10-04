// A person's payment notes reach their own Venmo lines wherever money is
// drawn — the screens and what a connected app is told — and nothing else.

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
  personal_finance_category: { primary: "TRANSFER_OUT", detailed: "TRANSFER_OUT" },
});

vi.mock("./account-store", () => ({
  loadAccount: async () => ({
    firstName: null,
    timeZone: "UTC",
    plan: { budgets: null, goals: null },
    categories: { v: 1, merchants: {}, transactions: {} },
    manual: [],
    imports: [],
    lockedImports: [],
    wallets: [],
    p2pNotes: { v: 1, notes: { "t-venmo": { app: "venmo", dir: "to", name: "Alex Kim", note: "pizza", date: "2026-09-12" } } },
    items: [{ itemId: "item-1", accessToken: "access-sandbox-1", institutionId: null, institutionName: "First Bank", linkedAt: "2026-09-01" }],
    plaidSync: new Map([
      ["item-1", { state: { v: 1, cursor: "c-1", ready: true, accounts: [checking], transactions: [line("t-venmo", "Venmo", 45), line("t-other", "Venmo", 12)] }, version: 1, syncedAt: new Date().toISOString(), changedAt: null }],
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

describe("payment notes", () => {
  it("reach the person's own line, and only that line, in what a connected app is told", async () => {
    vi.stubEnv("PLAID_CLIENT_ID", "id");
    vi.stubEnv("PLAID_SECRET", "secret");
    vi.stubGlobal("fetch", vi.fn());
    const { agentFinance, morningFinance } = await import("./finance");
    const data = await agentFinance({ userId: "u1", email: "a@x.test", supabase: {} } as never);
    const by = Object.fromEntries(data.transactions.map((t) => [t.id, t]));
    expect(by["t-venmo"]!.p2p).toEqual({ app: "venmo", dir: "to", name: "Alex Kim", note: "pizza", date: "2026-09-12" });
    expect(by["t-other"]!.p2p).toBeUndefined();

    // The morning check never reads them: its money has no notes at all.
    const morning = await morningFinance(
      {
        items: [{ itemId: "item-1", accessToken: "access-sandbox-1", institutionId: null, institutionName: "First Bank", linkedAt: "2026-09-01" }],
        plaidSync: { stored: new Map([["item-1", { state: { v: 1, cursor: "c-1", ready: true, accounts: [checking], transactions: [line("t-venmo", "Venmo", 45)] }, version: 1, syncedAt: new Date().toISOString(), changedAt: null }]]), save: null, clear: null, minimal: true },
        categories: { v: 1, merchants: {}, transactions: {} },
        manual: [],
        imports: [],
        wallets: { list: [], save: null, scan: null, offline: true },
        coinbase: null,
      } as never,
      { budgets: null, goals: null },
      "2026-09-20",
    );
    expect(morning!.transactions.every((t) => t.p2p === undefined)).toBe(true);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
