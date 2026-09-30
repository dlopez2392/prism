// A bank that wants its owner to sign in again (a changed password, an
// expired consent) stays on screen as of its last sync, marked for that
// sign-in, so it never vanishes from their net worth and goals meanwhile, nor
// shows them less than their household already sees of it. A bank Plaid
// simply can't reach says so, without asking anyone to sign in.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaidAccount } from "@/lib/plaid/client";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, has: () => false }), headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => null }));

const savings: PlaidAccount = { account_id: "acc-sav", name: "Savings", official_name: null, mask: "0002", type: "depository", subtype: "savings", balances: { available: 8_000, current: 8_000, iso_currency_code: "USD" } };
const brokerage: PlaidAccount = { account_id: "acc-inv", name: "Brokerage", official_name: null, mask: "0003", type: "investment", subtype: "brokerage", balances: { available: null, current: 12_000, iso_currency_code: "USD" } };
const LAST_SYNC = "2026-09-28T15:00:00.000Z";
/** Whether Prism has a stored copy of the bank to fall back on. */
const hasCopy = { current: true };

vi.mock("./account-store", () => ({
  loadAccount: async () => ({
    firstName: null,
    timeZone: "UTC",
    plan: { budgets: null, goals: null },
    categories: { v: 1, merchants: {}, transactions: {} },
    manual: [],
    imports: [],
    lockedImports: [],
    items: [{ itemId: "item-1", accessToken: "access-production-1", institutionId: null, institutionName: "First Bank", linkedAt: "2026-09-01" }],
    // Old enough that this visit asks Plaid again.
    plaidSync: new Map(hasCopy.current ? [["item-1", { state: { v: 1, cursor: "c-1", ready: true, accounts: [savings, brokerage], transactions: [] }, version: 1, syncedAt: LAST_SYNC, changedAt: null }]] : []),
    coinbase: null,
    feedUpdatedAt: null,
    reseal: null,
  }),
  liveCoinbaseToken: vi.fn(),
  saveAccountPlaidSync: vi.fn(),
  saveAccountTimeZone: vi.fn(),
  saveFeedSnapshot: vi.fn(),
}));

/** Plaid refusing every call with `code`. */
const plaidSays = (code: string) =>
  vi.fn<typeof fetch>(async () => Response.json({ error_type: "ITEM_ERROR", error_code: code, error_message: "…", display_message: null }, { status: 400 }));

async function load() {
  vi.resetModules();
  const { agentFinance } = await import("./finance");
  return agentFinance({ userId: "u1", email: "a@x.test", supabase: {} } as never);
}

describe("a bank that needs its owner to sign in again", () => {
  beforeEach(() => {
    vi.stubEnv("PLAID_CLIENT_ID", "id");
    vi.stubEnv("PLAID_SECRET", "secret");
    hasCopy.current = true;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("stays on screen as of its last sync, marked for that sign-in", async () => {
    const plaid = plaidSays("ITEM_LOGIN_REQUIRED");
    vi.stubGlobal("fetch", plaid);
    const data = await load();
    expect(data.accounts.map((a) => [a.name, a.balance])).toEqual([["Savings", 800_000], ["Brokerage", 1_200_000]]);
    // Holdings aren't in the copy, and a bank waiting on a sign-in would only refuse again: it isn't asked.
    expect(plaid.mock.calls.map(([url]) => new URL(String(url)).pathname)).not.toContain("/investments/holdings/get");
    expect(data.institutions).toEqual([{ id: "item-1", name: "First Bank", health: "needs_attention", signInAgain: true, lastSyncedAt: LAST_SYNC, source: "plaid" }]);
    expect(data.notice).toBe("First Bank needs you to sign in again — showing it as of the last sync.");
  });

  it("is still marked for that sign-in when there's no copy to show", async () => {
    hasCopy.current = false;
    vi.stubGlobal("fetch", plaidSays("ITEM_LOGIN_REQUIRED"));
    const data = await load();
    expect(data.accounts).toEqual([]);
    expect(data.institutions).toEqual([{ id: "item-1", name: "First Bank", health: "needs_attention", signInAgain: true, lastSyncedAt: null, source: "plaid" }]);
    expect(data.notice).toBe("First Bank needs you to sign in again.");
  });

  it("isn't asked to sign in when Plaid is only unreachable", async () => {
    vi.stubGlobal("fetch", plaidSays("INSTITUTION_DOWN"));
    const data = await load();
    expect(data.institutions[0]).not.toHaveProperty("signInAgain");
    expect(data.notice).toBe("First Bank couldn't be updated just now — showing it as of the last sync.");
    hasCopy.current = false;
    const none = await load();
    expect(none.institutions).toEqual([{ id: "item-1", name: "First Bank", health: "needs_attention", lastSyncedAt: null, source: "plaid" }]);
    expect(none.notice).toBe("We couldn't reach First Bank just now.");
  });
});
