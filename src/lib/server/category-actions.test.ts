// Saving a category fix (category-actions.ts): only for a signed-in account,
// only what validates, sealed, and never over fixes it couldn't read.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
const signedIn = { current: null as unknown };
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => signedIn.current }));

const { fixCategory } = await import("./category-actions");
const { openPacked, sealPacked } = await import("./vault");

const KEY = randomBytes(32);
const IDLE = { status: "idle" as const };

/** The person's profile row, as the action reads and writes it. */
function profileDb(stored: string | null, { readFails = false } = {}) {
  const row = { sealed_category_rules: stored };
  const writes: Record<string, unknown>[] = [];
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => (readFails ? { data: null, error: { message: "timeout" } } : { data: row, error: null }) }) }),
      upsert: async (values: Record<string, unknown>) => (writes.push(values), Object.assign(row, values), { error: null }),
    }),
  };
  return { db, row, writes };
}
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("saving a category fix", () => {
  beforeEach(() => vi.stubEnv("PRISM_VAULT_KEY", KEY.toString("base64")));
  afterEach(() => {
    vi.unstubAllEnvs();
    signedIn.current = null;
  });

  it("needs a signed-in account", async () => {
    const res = await fixCategory(IDLE, form({ transactionId: "t1", merchant: "Blue Bottle", category: "food", everyAtMerchant: "on" }));
    expect(res).toMatchObject({ status: "error", message: expect.stringMatching(/Sign in/) });
  });

  it("keeps every purchase at the merchant, sealed, and says so", async () => {
    const { db, row } = profileDb(null);
    signedIn.current = { userId: "u1", email: "a@x.test", supabase: db };
    const res = await fixCategory(IDLE, form({ transactionId: "t1", merchant: "Blue Bottle", category: "food", everyAtMerchant: "on" }));
    expect(res).toMatchObject({ status: "saved", message: "Every purchase at Blue Bottle is now Food & dining." });
    expect(row.sealed_category_rules).not.toContain("Blue");
    expect(openPacked(row.sealed_category_rules, KEY)).toEqual({ v: 1, merchants: { "blue bottle": "food" }, transactions: {} });
  });

  it("adds to the fixes already there, and can go back to the bank's categories", async () => {
    const { db, row } = profileDb(sealPacked({ v: 1, merchants: { "corner shop": "food" }, transactions: {} }, KEY));
    signedIn.current = { userId: "u1", email: "a@x.test", supabase: db };
    await fixCategory(IDLE, form({ transactionId: "t2", merchant: "Zelle to J. Smith", category: "housing" }));
    expect(openPacked(row.sealed_category_rules, KEY)).toEqual({ v: 1, merchants: { "corner shop": "food" }, transactions: { t2: "housing" } });
    const res = await fixCategory(IDLE, form({ intent: "reset", transactionId: "t9", merchant: "Corner Shop" }));
    expect(res).toMatchObject({ status: "saved", message: "Corner Shop is back to your bank's categories." });
    expect(openPacked(row.sealed_category_rules, KEY)).toEqual({ v: 1, merchants: {}, transactions: { t2: "housing" } });
  });

  it("writes nothing for a category Prism doesn't have, or a missing transaction", async () => {
    const { db, writes } = profileDb(null);
    signedIn.current = { userId: "u1", email: "a@x.test", supabase: db };
    for (const bad of [
      { transactionId: "t1", merchant: "Blue Bottle", category: "crypto-mining" },
      { transactionId: "t1", merchant: "Blue Bottle", category: "toString" },
      { transactionId: "", merchant: "Blue Bottle", category: "food" },
      { transactionId: "t1", merchant: "x".repeat(201), category: "food" },
    ]) {
      expect(await fixCategory(IDLE, form(bad))).toMatchObject({ status: "error" });
    }
    expect(writes).toEqual([]);
  });

  it("never writes over fixes it couldn't read", async () => {
    const { db, writes } = profileDb(null, { readFails: true });
    signedIn.current = { userId: "u1", email: "a@x.test", supabase: db };
    expect(await fixCategory(IDLE, form({ transactionId: "t1", merchant: "Blue Bottle", category: "food", everyAtMerchant: "on" }))).toMatchObject({ status: "error" });
    expect(writes).toEqual([]);
  });
});
