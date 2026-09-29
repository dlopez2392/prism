// What someone adds by hand reaches Net worth and Claude like any account,
// and on its own it is already their household, not the example one.

import { describe, expect, it, vi } from "vitest";
import type { ManualItem } from "@/lib/finance/manual";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, has: () => false }), headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => null }));

const thisMonth = new Date().toISOString().slice(0, 7);
const manual: ManualItem[] = [
  { id: "our-house", kind: "home", name: "Our house", values: [{ month: thisMonth, value: 35_000_000 }] },
  { id: "loan-from-mom", kind: "debt", name: "Loan from Mom", values: [{ month: thisMonth, value: 500_000 }] },
];
vi.mock("./account-store", () => ({
  loadAccount: async () => ({
    firstName: "Dana",
    timeZone: "UTC",
    plan: { budgets: null, goals: null },
    categories: { v: 1, merchants: {}, transactions: {} },
    manual,
    items: [],
    plaidSync: new Map(),
    coinbase: null,
    feedUpdatedAt: null,
    reseal: null,
  }),
  liveCoinbaseToken: vi.fn(),
  saveAccountPlaidSync: vi.fn(),
  saveAccountTimeZone: vi.fn(),
  saveFeedSnapshot: vi.fn(),
}));

describe("things added by hand", () => {
  it("are the person's own household on their own: never the example one, and a connected app sees them", async () => {
    const plaid = vi.fn();
    vi.stubGlobal("fetch", plaid);
    const { agentFinance } = await import("./finance");
    const data = await agentFinance({ userId: "u1", email: "a@x.test", supabase: {} } as never);
    expect(data.demo).toBe(false);
    expect(data.source).toBe("manual");
    expect(data.institutions).toEqual([expect.objectContaining({ id: "manual", name: "Added by you" })]);
    expect(data.accounts.map((a) => [a.name, a.kind, a.balance])).toEqual([
      ["Our house", "property", 35_000_000],
      ["Loan from Mom", "loan", -500_000],
    ]);
    // No transactions of their own yet: nothing drafted, nothing invented.
    expect(data.transactions).toEqual([]);
    expect(data.budgets).toEqual([]);
    expect(plaid).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
