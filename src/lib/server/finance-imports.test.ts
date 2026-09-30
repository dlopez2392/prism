// History imported from a file, in the person's own money (finance.ts):
// older history of a linked account joins it, but only from before the
// bank's own first transaction, so no day counts twice; anything else is an
// account of its own. Category fixes reach it, and someone whose only money
// is imported is never shown the example household.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportedHistory } from "@/lib/finance/import";
import type { PlaidAccount, PlaidTransaction } from "@/lib/plaid/client";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: () => undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, has: () => false }), headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => ({ userId: "u1", email: "a@x.test", supabase: {} }) }));

const checking: PlaidAccount = { account_id: "chk", name: "Everyday Checking", official_name: null, mask: "4821", type: "depository", subtype: "checking", balances: { available: 900, current: 900, iso_currency_code: "USD" } };
const tx = (id: string, date: string, dollars: number, name: string): PlaidTransaction => ({ transaction_id: id, account_id: "chk", amount: dollars, date, name, merchant_name: name, pending: false, personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "x" } });

const money = { banks: true, manual: [] as unknown[], imports: [] as ImportedHistory[], locked: [] as { id: string; importedAt: string }[], rules: { v: 1, merchants: {} as Record<string, string>, transactions: {} as Record<string, string> } };
vi.mock("./account-store", () => ({
  loadAccount: async () => ({
    firstName: "Dana",
    timeZone: "UTC",
    plan: { budgets: null, goals: null },
    categories: money.rules,
    manual: money.manual,
    imports: money.imports,
    lockedImports: money.locked,
    inHousehold: false,
    coinbaseShared: null,
    items: money.banks ? [{ itemId: "item-1", accessToken: "access-1", institutionId: null, institutionName: "Northwind Bank", linkedAt: "2026-09-01" }] : [],
    // The bank's own history starts on 2024-10-01.
    plaidSync: new Map([["item-1", { state: { v: 1, cursor: "c", ready: true, accounts: [checking], transactions: [tx("p1", "2024-10-01", 20, "Corner Café"), tx("p2", "2026-09-10", 30, "Corner Café")] }, version: 1, syncedAt: new Date().toISOString(), changedAt: null }]]),
    coinbase: null,
    feedUpdatedAt: new Date().toISOString(),
    reseal: null,
  }),
  liveCoinbaseToken: vi.fn(),
  saveAccountPlaidSync: vi.fn(),
  saveAccountTimeZone: vi.fn(),
  saveFeedSnapshot: vi.fn(),
  saveCoinbaseValue: vi.fn(),
}));

const imported = (id: string, attachTo: string | null, rows: ImportedHistory["rows"], name = "From Mint"): ImportedHistory => ({
  id,
  meta: { name, kind: "checking", attachTo, source: "mint", parts: 1 },
  rows,
  importedAt: "2026-09-30T10:00:00Z",
});

async function mine() {
  vi.resetModules();
  const { getPersonalFinance } = await import("./finance");
  return getPersonalFinance();
}

describe("imported history", () => {
  beforeEach(() => {
    vi.stubEnv("PLAID_CLIENT_ID", "id");
    vi.stubEnv("PLAID_SECRET", "secret");
    vi.stubEnv("PRISM_VAULT_KEY", randomBytes(32).toString("base64"));
    vi.stubGlobal("fetch", vi.fn());
    Object.assign(money, { banks: true, manual: [], imports: [], locked: [], rules: { v: 1, merchants: {}, transactions: {} } });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("joins a linked account as its older history, only from before the bank's own, so no day counts twice", async () => {
    money.imports = [
      imported("a", "chk", [
        { date: "2023-05-01", amount: -1_500, merchant: "Old Diner", category: "food" },
        { date: "2024-09-30", amount: -2_000, merchant: "Last Mint Day", category: "food" },
        // The bank's own copy has this day and after: left out, though it's in the file.
        { date: "2024-10-01", amount: -2_000, merchant: "Corner Café", category: "food" },
      ]),
    ];
    const data = await mine();
    const onChecking = data.transactions.filter((t) => t.accountId === "chk");
    expect(onChecking.map((t) => [t.id, t.date])).toEqual([
      ["imp-a-0", "2023-05-01"],
      ["imp-a-1", "2024-09-30"],
      ["p1", "2024-10-01"],
      ["p2", "2026-09-10"],
    ]);
    expect(data.accounts.map((a) => a.id)).toEqual(["chk"]);
    expect(data.imports).toEqual([{ id: "a", name: "From Mint", attachTo: "chk", rows: 3, from: "2023-05-01", to: "2024-10-01", importedAt: "2026-09-30T10:00:00Z" }]);
  });

  it("is an account of its own when it isn't older history of a linked one, or that one is gone", async () => {
    money.imports = [
      imported("b", null, [{ date: "2019-02-01", amount: -9_900, merchant: "Closed Card Shop", category: "shopping" }], "Old Visa"),
      imported("c", "an-account-since-disconnected", [{ date: "2020-03-01", amount: -500, merchant: "Somewhere", category: "other" }], "Gone Bank"),
    ];
    const data = await mine();
    expect(data.accounts.filter((a) => a.source === "import").map((a) => [a.id, a.name, a.balance])).toEqual([
      ["import-b", "Old Visa", 0],
      ["import-c", "Gone Bank", 0],
    ]);
    expect(data.transactions.find((t) => t.id === "imp-b-0")).toMatchObject({ accountId: "import-b", merchant: "Closed Card Shop", amount: -9_900 });
  });

  it("joins only a bank account, never something added by hand, whatever the import says", async () => {
    money.manual = [{ id: "car", kind: "vehicle", name: "Our car", values: [{ month: "2026-09", value: 1_500_000 }] }];
    money.imports = [imported("f", "manual-car", [{ date: "2020-03-01", amount: -500, merchant: "Somewhere", category: "other" }], "Car log")];
    const data = await mine();
    expect(data.transactions.find((t) => t.id === "imp-f-0")).toMatchObject({ accountId: "import-f" });
    expect(data.accounts.find((a) => a.id === "manual-car")).toMatchObject({ source: "manual", balance: 1_500_000 });
  });

  it("takes the person's category fixes, like any other transaction", async () => {
    money.imports = [imported("d", null, [{ date: "2021-01-01", amount: -4_000, merchant: "Blue Bottle", category: "shopping" }])];
    money.rules = { v: 1, merchants: { "blue bottle": "food" }, transactions: {} };
    const data = await mine();
    expect(data.transactions.find((t) => t.id === "imp-d-0")).toMatchObject({ category: "food", bankCategory: "shopping" });
  });

  it("is the person's own money when it's all they have: never the example household", async () => {
    money.banks = false;
    money.imports = [imported("e", null, [{ date: "2022-06-01", amount: -1_000, merchant: "Just Imported", category: "food" }])];
    const data = await mine();
    expect(data.source).toBe("import");
    expect(data.transactions.map((t) => t.merchant)).toEqual(["Just Imported"]);
  });

  it("lists an import that won't open for Connections, so it can be removed, without a row of it on any screen", async () => {
    money.locked = [{ id: "gone", importedAt: "2026-09-01T10:00:00Z" }];
    const data = await mine();
    expect(data.lockedImports).toEqual([{ id: "gone", importedAt: "2026-09-01T10:00:00Z" }]);
    expect(data.imports).toEqual([]);
    expect(data.transactions.some((t) => t.id.startsWith("imp-gone-"))).toBe(false);
  });
});
