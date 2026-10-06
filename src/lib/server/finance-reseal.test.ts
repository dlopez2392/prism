// Who moves an account's seals to a new vault key (account-store's `reseal`):
// the person's own visit, after the response, and never a connected app,
// whose writes the database refuses anyway.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const scheduled: (() => unknown)[] = [];
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (fn: () => unknown) => void scheduled.push(fn) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, has: () => false }), headers: async () => new Headers() }));
const account = { userId: "u1", email: "a@x.test", supabase: {} };
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => account }));
const reseal = vi.fn(async () => undefined);
vi.mock("./account-store", () => ({
  loadAccount: async () => ({ firstName: null, timeZone: null, language: "en", plan: { budgets: null, goals: null }, categories: { v: 1, merchants: {}, transactions: {} }, manual: [], imports: [], lockedImports: [], wallets: [], items: [], plaidSync: new Map(), coinbase: null, feedUpdatedAt: null, reseal }),
  liveCoinbaseToken: vi.fn(),
  saveAccountPlaidSync: vi.fn(),
  saveAccountLanguage: vi.fn(async () => undefined),
  saveAccountTimeZone: vi.fn(),
  saveFeedSnapshot: vi.fn(),
}));

const { agentFinance, readSources } = await import("./finance");

describe("moving seals to a new vault key", () => {
  afterEach(() => {
    scheduled.length = 0;
    reseal.mockClear();
  });

  it("happens on the person's own visit, after the response", async () => {
    await readSources();
    expect(reseal).not.toHaveBeenCalled();
    expect(scheduled).toEqual([reseal]);
  });

  it("never happens for a connected app", async () => {
    await agentFinance(account as never);
    expect(scheduled).toEqual([]);
    expect(reseal).not.toHaveBeenCalled();
  });
});
