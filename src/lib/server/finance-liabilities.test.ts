// A card's or a loan's terms (Plaid Liabilities) in the person's own finances
// (finance.ts). Plaid bills them per bank from the first read, so they are
// read only when the operator has switched them on, only for a bank holding a
// card or a loan, at most once a day, and never for a connected app, which
// can't keep what it reads and would read them again on every question.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaidAccount } from "@/lib/plaid/client";
import type { StoredLiabilities } from "@/lib/plaid/liabilities";

vi.mock("server-only", () => ({}));
const scheduled: (() => unknown)[] = [];
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (fn: () => unknown) => void scheduled.push(fn) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, has: () => false }), headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => ({ userId: "u1", email: "a@x.test", supabase: {} }) }));

const account = (id: string, type: PlaidAccount["type"], current: number): PlaidAccount => ({ account_id: id, name: id, official_name: null, mask: "0001", type, subtype: null, balances: { available: null, current, iso_currency_code: "USD" } });
const checking = account("chk", "depository", 2_000);
const card = account("card", "credit", 1_300);
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const DUE = (() => {
  const d = new Date(Date.now() + 10 * 86_400_000);
  return d.toISOString().slice(0, 10);
})();

/** What the stored copy holds: the bank's accounts and, maybe, terms read before. */
const bank = { accounts: [checking, card], liabilities: null as StoredLiabilities | null, syncedAt: ago(2 * HOUR) };
const saveAccountPlaidSync = vi.fn(async () => true);
vi.mock("./account-store", () => ({
  loadAccount: async () => ({
    firstName: "Dana",
    timeZone: "UTC",
    plan: { budgets: null, goals: null },
    categories: { v: 1, merchants: {}, transactions: {} },
    manual: [],
    inHousehold: false,
    coinbaseShared: null,
    items: [{ itemId: "item-1", accessToken: "access-production-1", institutionId: null, institutionName: "First Bank", linkedAt: "2026-09-30" }],
    plaidSync: new Map([["item-1", { state: { v: 1, cursor: "c-1", ready: true, accounts: bank.accounts, transactions: [], ...(bank.liabilities ? { liabilities: bank.liabilities } : {}) }, version: 3, syncedAt: bank.syncedAt, changedAt: null }]]),
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

/** Plaid, answering what finance.ts asks. `refuse` makes /liabilities/get fail. */
const plaid = { refuse: false };
const fetchPlaid = vi.fn(async (url: RequestInfo | URL) => {
  const path = new URL(String(url)).pathname;
  if (path === "/accounts/get") return Response.json({ accounts: bank.accounts, item: { institution_id: null } });
  if (path === "/transactions/sync") return Response.json({ added: [], modified: [], removed: [], next_cursor: "c-2", has_more: false, transactions_update_status: "HISTORICAL_UPDATE_COMPLETE" });
  if (path === "/liabilities/get") {
    if (plaid.refuse) return Response.json({ error_type: "ITEM_ERROR", error_code: "PRODUCTS_NOT_SUPPORTED", error_message: "not supported" }, { status: 400 });
    return Response.json({ liabilities: { credit: [{ account_id: "card", aprs: [{ apr_percentage: 24.99, apr_type: "purchase_apr" }], is_overdue: false, last_statement_balance: 1240, minimum_payment_amount: 35, next_payment_due_date: DUE }], mortgage: [], student: [] } });
  }
  return Response.json({ error_code: "NOT_FOUND" }, { status: 404 });
});
const asked = () => fetchPlaid.mock.calls.map(([url]) => new URL(String(url)).pathname);

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
  return agentFinance({ userId: "u1", email: "a@x.test", supabase: {} } as never);
}
const savedState = () => (saveAccountPlaidSync.mock.calls.at(-1) as unknown[] | undefined)?.[2] as { liabilities?: StoredLiabilities } | undefined;

describe("a card's terms from its lender", () => {
  beforeEach(() => {
    vi.stubEnv("PLAID_CLIENT_ID", "id");
    vi.stubEnv("PLAID_SECRET", "secret");
    vi.stubEnv("PRISM_VAULT_KEY", randomBytes(32).toString("base64"));
    vi.stubGlobal("fetch", fetchPlaid);
    Object.assign(bank, { accounts: [checking, card], liabilities: null, syncedAt: ago(2 * HOUR) });
    plaid.refuse = false;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchPlaid.mockClear();
    saveAccountPlaidSync.mockClear();
    scheduled.length = 0;
  });

  it("are never read while the operator hasn't switched them on", async () => {
    const data = await ownVisit();
    expect(asked()).not.toContain("/liabilities/get");
    expect(data.accounts.find((a) => a.id === "card")).not.toHaveProperty("liability");
  });

  it("kept from before aren't shown once switched off: nothing would keep them up to date", async () => {
    bank.liabilities = { at: ago(3 * HOUR), list: [{ account_id: "card", due: DUE, minimum: 40, statement: 900, apr: 22, overdue: false }] };
    const data = await ownVisit();
    expect(data.accounts.find((a) => a.id === "card")).not.toHaveProperty("liability");
  });

  it("are read once switched on, shown on the card, and kept with the bank's copy", async () => {
    vi.stubEnv("PLAID_LIABILITIES", "on");
    const data = await ownVisit();
    expect(asked().filter((p) => p === "/liabilities/get")).toHaveLength(1);
    expect(data.accounts.find((a) => a.id === "card")?.liability).toEqual({ dueDate: DUE, minimumPayment: 3_500, statementBalance: 124_000, apr: 24.99, overdue: false });
    expect(data.accounts.find((a) => a.id === "chk")).not.toHaveProperty("liability");
    expect(savedState()?.liabilities).toEqual({ at: expect.any(String), list: [expect.objectContaining({ account_id: "card", due: DUE, minimum: 35 })] });
  });

  it("aren't read again the same day: the kept ones are shown", async () => {
    vi.stubEnv("PLAID_LIABILITIES", "on");
    bank.liabilities = { at: ago(3 * HOUR), list: [{ account_id: "card", due: DUE, minimum: 40, statement: 900, apr: 22, overdue: false }] };
    const data = await ownVisit();
    // The bank itself was synced (its copy was two hours old); its terms weren't asked for again.
    expect(asked()).toContain("/transactions/sync");
    expect(asked()).not.toContain("/liabilities/get");
    expect(data.accounts.find((a) => a.id === "card")?.liability).toMatchObject({ minimumPayment: 4_000, apr: 22 });
    expect(savedState()?.liabilities).toEqual(bank.liabilities);
  });

  it("are asked of no bank that holds no card or loan", async () => {
    vi.stubEnv("PLAID_LIABILITIES", "on");
    bank.accounts = [checking];
    await ownVisit();
    expect(asked()).not.toContain("/liabilities/get");
  });

  it("are never read for a connected app, which would read them again on every question", async () => {
    vi.stubEnv("PLAID_LIABILITIES", "on");
    bank.liabilities = { at: ago(30 * HOUR), list: [{ account_id: "card", due: DUE, minimum: 40, statement: 900, apr: 22, overdue: false }] };
    const data = await connectedApp();
    expect(asked()).toContain("/transactions/sync");
    expect(asked()).not.toContain("/liabilities/get");
    // What the person's own visit kept is still what it answers from.
    expect(data.accounts.find((a) => a.id === "card")?.liability).toMatchObject({ minimumPayment: 4_000 });
  });

  it("that Plaid won't give leave the page whole, the reason in the log, and no second try that day", async () => {
    vi.stubEnv("PLAID_LIABILITIES", "on");
    plaid.refuse = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const data = await ownVisit();
    expect(data.accounts.map((a) => a.id).sort()).toEqual(["card", "chk"]);
    expect(data.accounts.find((a) => a.id === "card")).not.toHaveProperty("liability");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^Plaid Liabilities not read for a bank: .*PRODUCTS_NOT_SUPPORTED/));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("access-production-1");
    expect(savedState()?.liabilities).toEqual({ at: expect.any(String), list: [] });
  });
});
