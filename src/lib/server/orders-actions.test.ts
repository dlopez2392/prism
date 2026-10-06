// Keeping what Amazon charges paid for (orders-actions.ts): only for a
// signed-in account, only on the person's own Amazon lines whose items add up
// to the charge, sealed, merged with what's there, a batch at a time, and
// never over orders it couldn't read.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "@/lib/finance/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/i18n/server", async () => ({ getT: async () => (await import("@/lib/i18n/t")).EN }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
const signedIn = { current: null as unknown };
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => signedIn.current }));
const money = { current: { source: "plaid", transactions: [] as Transaction[] } };
vi.mock("./finance", () => ({ getPersonalFinance: async () => money.current }));

const { saveOrderMatches, removeOrderNotes } = await import("./orders-actions");
const { openPacked, sealPacked } = await import("./vault");

const KEY = randomBytes(32);

const txn = (id: string, date: string, amount: number, merchant: string): Transaction => ({ id, accountId: "card", date, amount, merchant, category: "shopping", pending: false });
const MINE = [txn("a1", "2026-09-04", -3_497, "AMZN Mktp US*2K4"), txn("a2", "2026-09-10", -3_150, "AMAZON.COM*9Z8"), txn("d1", "2026-09-04", -3_497, "Corner Deli")];
const dogFood = { txnId: "a1", order: "111-0000001-0000001", date: "2026-09-02", items: [{ name: "Dog food", qty: 1, amount: 2_499 }, { name: "USB-C cable", qty: 2, amount: 998 }] };
const lamp = { txnId: "a2", order: "111-0000001-0000001", date: "2026-09-02", items: [{ name: "Desk lamp", qty: 1, amount: 3_150 }] };

function profileDb(stored: string | null, { readFails = false } = {}) {
  const row = { sealed_order_notes: stored };
  const writes: Record<string, unknown>[] = [];
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => (readFails ? { data: null, error: { message: "timeout" } } : { data: row, error: null }) }) }),
      upsert: async (values: Record<string, unknown>) => (writes.push(values), Object.assign(row, values), { error: null }),
    }),
  };
  return { db, row, writes };
}
const signIn = (db: unknown) => (signedIn.current = { userId: "u1", email: "a@x.test", supabase: db });
const kept = (row: { sealed_order_notes: string | null }) => (openPacked(row.sealed_order_notes!, KEY) as { notes: Record<string, unknown> }).notes;

describe("keeping Amazon orders", () => {
  beforeEach(() => {
    vi.stubEnv("PRISM_VAULT_KEY", KEY.toString("base64"));
    money.current = { source: "plaid", transactions: MINE };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    signedIn.current = null;
  });

  it("needs a signed-in account", async () => {
    expect(await saveOrderMatches([dogFood])).toMatchObject({ status: "error", message: expect.stringMatching(/Sign in/) });
  });

  it("keeps the matches, sealed, and counts them", async () => {
    const { db, row } = profileDb(null);
    signIn(db);
    expect(await saveOrderMatches([dogFood, lamp])).toMatchObject({ status: "saved", saved: 2, dropped: 0 });
    expect(row.sealed_order_notes).not.toContain("Dog food");
    expect(kept(row)).toEqual({ a1: { order: dogFood.order, date: dogFood.date, items: dogFood.items }, a2: { order: lamp.order, date: lamp.date, items: lamp.items } });
  });

  it("drops what isn't the person's own Amazon line, or doesn't add up to it, and counts it", async () => {
    const { db, row } = profileDb(null);
    signIn(db);
    const res = await saveOrderMatches([dogFood, { ...dogFood, txnId: "d1" }, { ...dogFood, txnId: "not-mine" }, { ...lamp, items: [{ name: "Lamp", qty: 1, amount: 3_000 }] }, "junk"]);
    expect(res).toMatchObject({ status: "saved", saved: 1, dropped: 4 });
    expect(Object.keys(kept(row))).toEqual(["a1"]);
  });

  it("adds each batch to the orders already there", async () => {
    const { db, row } = profileDb(sealPacked({ v: 1, notes: { a2: { order: lamp.order, date: lamp.date, items: lamp.items } } }, KEY));
    signIn(db);
    await saveOrderMatches([dogFood]);
    expect(Object.keys(kept(row)).sort()).toEqual(["a1", "a2"]);
  });

  it("writes nothing when a batch has nothing that matches, and says so in its counts", async () => {
    const { db, writes } = profileDb(null);
    signIn(db);
    expect(await saveOrderMatches([{ ...dogFood, txnId: "d1" }])).toMatchObject({ status: "saved", saved: 0, dropped: 1 });
    expect(writes).toEqual([]);
  });

  it("never writes over orders it couldn't read", async () => {
    const { db, writes } = profileDb(null, { readFails: true });
    signIn(db);
    expect(await saveOrderMatches([dogFood])).toMatchObject({ status: "error" });
    expect(writes).toEqual([]);
  });

  it("refuses the example household, nothing to match, and a batch too big to send", async () => {
    const { db, writes } = profileDb(null);
    signIn(db);
    money.current = { source: "demo", transactions: MINE };
    expect(await saveOrderMatches([dogFood])).toMatchObject({ status: "error", message: expect.stringMatching(/Link the card/) });
    money.current = { source: "plaid", transactions: MINE };
    expect(await saveOrderMatches([])).toMatchObject({ status: "error" });
    expect(await saveOrderMatches("a1")).toMatchObject({ status: "error" });
    expect(await saveOrderMatches(Array.from({ length: 151 }, () => dogFood))).toMatchObject({ status: "error", message: expect.stringMatching(/too many at once/) });
    expect(writes).toEqual([]);
  });

  it("forgets them all on request", async () => {
    const { db, row } = profileDb(sealPacked({ v: 1, notes: { a1: dogFood } }, KEY));
    signIn(db);
    expect(await removeOrderNotes()).toMatchObject({ status: "saved", message: expect.stringMatching(/gone/) });
    expect(row.sealed_order_notes).toBeNull();
  });
});
