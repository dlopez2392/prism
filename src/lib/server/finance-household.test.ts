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
const lastMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
const spend = (id: string, account: string, merchant: string, dollars: number, on = `${month}-02`): PlaidTransaction => ({ transaction_id: id, account_id: account, amount: dollars, date: on, name: merchant, merchant_name: merchant, pending: false, personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "x" } });
const copy = (accounts: PlaidAccount[], transactions: PlaidTransaction[]) => ({ v: 1, cursor: "c", ready: true, accounts, transactions });

const inHousehold = { current: true };
const NO_PLAN = { budgets: null, goals: null, budgetsVersion: 0, goalsVersion: 0, budgetsChanged: null, goalsChanged: null };
const plan = { current: NO_PLAN as unknown };
const shared = { mine: new Map<string, string | null>([["joint", "item-me"]]), fails: false, samCoinbase: false as false | "good" | "bad" };
/** History I imported: none unless a test adds some. */
const mineImports = { current: [] as unknown[] };
/** Wallets I added: none unless a test adds some. */
const mineWallets = { current: [] as unknown[] };
/** My splits, tags and who owes me: none unless a test adds some. */
const mineDetails = { current: { v: 1, lines: {} } as unknown };
vi.mock("./account-store", () => ({
  loadAccount: async () => ({
    firstName: "Dana",
    timeZone: "UTC",
    plan: { budgets: [{ category: "food", limit: 30_000 }], goals: null },
    categories: { v: 1, merchants: {}, transactions: {} },
    manual: [],
    imports: mineImports.current,
    lockedImports: [],
    wallets: mineWallets.current,
    details: mineDetails.current,
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
    loadHouseholdPlan: async () => plan.current,
    loadSharedMoney: async () => {
      if (shared.fails) throw new Error("rpc failed");
      return [
        {
          userId: "u-sam",
          firstName: "Sam",
          sharedAccountIds: shared.samCoinbase ? ["coinbase", "sam-card"] : ["sam-card"],
          sealedCategoryRules: sealPacked({ v: 1, merchants: { "gas & go": "transport" }, transactions: {} }, KEY),
          sealedManualItems: null,
          coinbase: shared.samCoinbase ? { sealed: sealPacked({ v: 1, balance: shared.samCoinbase === "good" ? 777_00 : -5 }, KEY), at: "2026-09-30T08:00:00Z" } : null,
          items: [
            {
              itemId: "item-sam",
              institutionName: "Summit Card",
              syncedAt: "2026-09-28T09:00:00Z",
              sealedSync: sealPacked(
                copy(
                  [bank("sam-card", "Rewards Visa", -300), bank("sam-private", "Sam's Savings", 50_000)],
                  [spend("s1", "sam-card", "Gas & Go", 40), spend("s0", "sam-card", "Corner Grocer", 1_200, `${lastMonth}-10`), spend("s2", "sam-private", "Sam's secret", 99), spend("s3", "sam-private", "Sam's secret", 9_000, `${lastMonth}-11`)],
                ),
                KEY,
              ),
            },
          ],
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
    shared.samCoinbase = false;
    plan.current = NO_PLAN;
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
    // Nobody's own budgets or goals come along: until the household sets its own,
    // they're drafted from what it shares (Sam's shared card, never his private savings).
    expect(data.budgets).toEqual([{ category: "food", limit: 40_000 }]);
    expect(data.goals).toEqual([]);
    expect(data).toMatchObject({ planEdited: { budgets: false, goals: false }, householdPlan: { budgetsVersion: 0, goalsVersion: 0 } });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("shows a member's shared Coinbase as its value from their last visit, and nothing more", async () => {
    jar.set("prism-view", "household");
    shared.samCoinbase = "good";
    let { getFinance } = await import("./finance");
    let data = await getFinance();
    expect(data.accounts.find((a) => a.id === "u-sam:coinbase")).toMatchObject({ name: "Coinbase", kind: "crypto", balance: 777_00, source: "coinbase" });
    expect(data.institutions.find((i) => i.id === "u-sam:coinbase")).toMatchObject({ name: "Coinbase · Sam", lastSyncedAt: "2026-09-30T08:00:00Z" });
    expect(data.holdings.filter((h) => h.accountId.startsWith("u-sam:"))).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    // A stored value that doesn't read as one shows no Coinbase at all, never a made-up number.
    vi.resetModules();
    shared.samCoinbase = "bad";
    ({ getFinance } = await import("./finance"));
    data = await getFinance();
    expect(data.accounts.some((a) => a.source === "coinbase")).toBe(false);
  });

  it("uses the household's own budgets and goals once someone sets them, and says who", async () => {
    jar.set("prism-view", "household");
    plan.current = {
      budgets: [{ category: "transport", limit: 20_000 }],
      goals: [
        { id: "trip", name: "Trip", emoji: "🗾", target: 500_000, saved: 50_000, monthlyContribution: 20_000, targetDate: "2027-06-30", colorSlot: 1 },
        // Follows my shared checking, by the id every member knows it by.
        { id: "rainy", name: "Rainy day", emoji: "🛟", target: 900_000, saved: 1, monthlyContribution: 0, targetDate: "2027-06-30", colorSlot: 2, accountId: "u-me:joint" },
      ],
      budgetsVersion: 3,
      goalsVersion: 5,
      budgetsChanged: { by: "Sam", at: "2026-09-29T18:00:00Z" },
      goalsChanged: null,
    };
    const { getFinance, getPersonalFinance } = await import("./finance");
    const data = await getFinance();
    expect(data.budgets).toEqual([{ category: "transport", limit: 20_000 }]);
    expect(data.goals).toEqual([
      expect.objectContaining({ id: "trip", saved: 50_000, history: [50_000] }),
      expect.objectContaining({ id: "rainy", saved: 50_000, accountId: "u-me:joint" }),
    ]);
    expect(data.accounts.map((a) => a.id).sort()).toEqual(["u-me:joint", "u-sam:sam-card"]);
    expect(data).toMatchObject({ planEdited: { budgets: true, goals: true }, householdPlan: { budgetsVersion: 3, goalsVersion: 5, budgetsChanged: { by: "Sam" } } });
    // Me is untouched: the person's own plan, and no household versions.
    const me = await getPersonalFinance();
    expect(me.budgets).toEqual([{ category: "food", limit: 30_000 }]);
    expect(me.householdPlan).toBeNull();
  });

  it("never shows the household history I imported, even the older history of an account I share", async () => {
    const meta = (attachTo: string | null) => ({ name: attachTo ? "Joint (Mint)" : "Old card", kind: "credit", attachTo, source: "mint", parts: 1 });
    mineImports.current = [
      { id: "i-joint", meta: meta("joint"), rows: [{ date: "2019-05-01", amount: -4_200, merchant: "Old Diner", category: "food" }], importedAt: "2026-09-30T10:00:00Z" },
      { id: "i-card", meta: meta(null), rows: [{ date: "2018-02-01", amount: -9_900, merchant: "Closed Card Shop", category: "shopping" }], importedAt: "2026-09-30T10:00:00Z" },
    ];
    const { getFinance } = await import("./finance");
    // On Me, they're mine and they're there…
    const me = await getFinance();
    expect(me.transactions.map((t) => t.merchant)).toEqual(expect.arrayContaining(["Old Diner", "Closed Card Shop"]));
    // …and in the Household view, where "joint" is shared, neither is.
    jar.set("prism-view", "household");
    vi.resetModules();
    const household = await (await import("./finance")).getFinance();
    expect(household.view).toBe("household");
    expect(household.transactions.map((t) => t.merchant)).not.toEqual(expect.arrayContaining(["Old Diner"]));
    expect(household.transactions.some((t) => t.id.startsWith("imp-") || t.merchant === "Closed Card Shop")).toBe(false);
    expect(household.accounts.some((a) => a.source === "import")).toBe(false);
    // The bank's own copy of the shared account is still there.
    expect(household.transactions.map((t) => t.merchant)).toContain("Corner Café");
    mineImports.current = [];
  });

  it("never shows the household a wallet, even one a share row names", async () => {
    // Read just now, so nothing is asked of any service.
    mineWallets.current = [
      {
        id: "a1b2c3d4e5f6",
        chain: "bitcoin",
        address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        name: "Cold storage",
        reading: { at: new Date().toISOString(), assets: [{ symbol: "BTC", name: "Bitcoin", units: "5120000", decimals: 8, usd: 428_000 }] },
      },
    ];
    shared.mine.set("wallet-a1b2c3d4e5f6", null);
    const { getFinance } = await import("./finance");
    const me = await getFinance();
    expect(me.accounts.find((a) => a.id === "wallet-a1b2c3d4e5f6")).toMatchObject({ name: "Cold storage", balance: 428_000, source: "wallet" });
    expect(me.holdings.some((h) => h.accountId === "wallet-a1b2c3d4e5f6")).toBe(true);
    expect(me.wallets.map((w) => w.name)).toEqual(["Cold storage"]);
    jar.set("prism-view", "household");
    vi.resetModules();
    const household = await (await import("./finance")).getFinance();
    expect(household.view).toBe("household");
    expect(household.accounts.some((a) => a.source === "wallet" || a.id.startsWith("wallet-"))).toBe(false);
    expect(household.holdings.some((h) => h.accountId.startsWith("wallet-"))).toBe(false);
    expect(household.institutions.some((i) => i.source === "wallet")).toBe(false);
    shared.mine.delete("wallet-a1b2c3d4e5f6");
    mineWallets.current = [];
  });

  it("shows the household my lines as the bank sent them: never my splits, tags or who owes me", async () => {
    mineDetails.current = { v: 1, lines: { m1: { split: [{ category: "food", amount: 700 }, { category: "fun", amount: 500 }], tags: ["Date night"], owed: { who: "Robin", amount: 600, paid: null } } } };
    const { getFinance } = await import("./finance");
    const me = await getFinance();
    expect(me.transactions.filter((t) => t.split?.of === "m1").map((t) => [t.category, t.amount])).toEqual([
      ["food", -700],
      ["fun", -500],
    ]);
    jar.set("prism-view", "household");
    vi.resetModules();
    const household = await (await import("./finance")).getFinance();
    expect(household.view).toBe("household");
    // One line, whole, in the bank's category, for every member alike.
    expect(household.transactions.filter((t) => t.merchant === "Corner Café").map((t) => [t.category, t.amount])).toEqual([["food", -1_200]]);
    const text = JSON.stringify(household.transactions);
    for (const mine of ["Date night", "Robin", "split"]) expect(text).not.toContain(mine);
    mineDetails.current = { v: 1, lines: {} };
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
    // Left the household between loading the account and loading its plan: their own money, said plainly.
    vi.resetModules();
    shared.fails = false;
    plan.current = null;
    const gone = await (await import("./finance")).getFinance();
    expect(gone).toMatchObject({ view: "me", householdPlan: null, notice: expect.stringMatching(/couldn't load your household/) });
    expect(data.accounts.map((a) => a.name).sort()).toEqual(["Joint Checking", "My Savings"]);
  });
});
