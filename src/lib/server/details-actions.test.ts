// Keeping splits, tags and who owes you (details-actions.ts): only for a
// signed-in account, only on the person's own whole lines, only what adds
// up, sealed, and never over details it couldn't read.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "@/lib/finance/types";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
const signedIn = { current: null as unknown };
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => signedIn.current }));
const money = { current: { source: "plaid", today: "2026-10-04", transactions: [] as Transaction[] } };
vi.mock("./finance", () => ({ getPersonalFinance: async () => money.current }));

const { saveTransactionDetail, markOwedPaid } = await import("./details-actions");
const { openPacked, sealPacked } = await import("./vault");

const KEY = randomBytes(32);
const txn = (id: string, amount: number, merchant: string, category: Transaction["category"], over: Partial<Transaction> = {}): Transaction => ({ id, accountId: "chk", date: "2026-09-20", amount, merchant, category, pending: false, ...over });
const MINE = [
  txn("c1", -15_000, "Costco", "food"),
  txn("pay", 250_000, "Acme Payroll", "income"),
  txn("p1", -4_000, "Pizza Place", "food", { pending: true }),
  // A line already split: its parts, as the person's own view shows them.
  txn("s1~1", -3_000, "Target", "shopping", { split: { of: "s1", part: 1, parts: 2, total: -5_000 } }),
  txn("s1~2", -2_000, "Target", "food", { split: { of: "s1", part: 2, parts: 2, total: -5_000 } }),
];
const SPLIT = { split: [{ category: "food", amount: 9_000 }, { category: "shopping", amount: 6_000 }] };

function profileDb(stored: string | null, { readFails = false } = {}) {
  const row = { sealed_txn_details: stored };
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
const opened = (row: { sealed_txn_details: string | null }) => openPacked(row.sealed_txn_details!, KEY) as { lines: Record<string, unknown> };

describe("keeping a transaction's details", () => {
  beforeEach(() => {
    vi.stubEnv("PRISM_VAULT_KEY", KEY.toString("base64"));
    money.current = { source: "plaid", today: "2026-10-04", transactions: MINE };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    signedIn.current = null;
  });

  it("needs a signed-in account", async () => {
    expect(await saveTransactionDetail("c1", SPLIT)).toMatchObject({ status: "error", message: expect.stringMatching(/Sign in/) });
  });

  it("keeps a split that adds up, sealed, and says what changed", async () => {
    const { db, row } = profileDb(null);
    signIn(db);
    expect(await saveTransactionDetail("c1", { ...SPLIT, tags: ["Party"] })).toMatchObject({ status: "saved", message: "Split into 2 parts. Every total now counts them that way." });
    expect(row.sealed_txn_details).not.toContain("Party");
    expect(opened(row).lines).toEqual({ c1: { split: SPLIT.split, tags: ["Party"] } });
  });

  it("changes a line already split by the id the bank gave it, never a part's", async () => {
    const { db, row } = profileDb(null);
    signIn(db);
    expect(await saveTransactionDetail("s1", { tags: ["Back to school"] })).toMatchObject({ status: "saved" });
    expect(Object.keys(opened(row).lines)).toEqual(["s1"]);
    expect(await saveTransactionDetail("s1~1", { tags: ["x"] })).toMatchObject({ status: "error", message: expect.stringMatching(/isn't one of yours/) });
  });

  it("refuses what doesn't add up, a line that isn't theirs or is pending, and the example household, writing nothing", async () => {
    const { db, writes } = profileDb(null);
    signIn(db);
    expect(await saveTransactionDetail("c1", { split: [{ category: "food", amount: 1 }, { category: "fun", amount: 1 }] })).toMatchObject({ status: "error", message: expect.stringMatching(/add up to \$150\.00/) });
    expect(await saveTransactionDetail("pay", SPLIT)).toMatchObject({ status: "error", message: expect.stringMatching(/money going out/) });
    expect(await saveTransactionDetail("not-mine", SPLIT)).toMatchObject({ status: "error" });
    expect(await saveTransactionDetail("p1", { tags: ["x"] })).toMatchObject({ status: "error", message: expect.stringMatching(/pending/) });
    expect(await saveTransactionDetail({ id: "c1" }, SPLIT)).toMatchObject({ status: "error" });
    money.current = { ...money.current, source: "demo" };
    expect(await saveTransactionDetail("c1", SPLIT)).toMatchObject({ status: "error", message: expect.stringMatching(/Link a bank/) });
    expect(writes).toEqual([]);
  });

  it("never writes over details it couldn't read", async () => {
    const { db, writes } = profileDb(null, { readFails: true });
    signIn(db);
    expect(await saveTransactionDetail("c1", SPLIT)).toMatchObject({ status: "error" });
    expect(writes).toEqual([]);
  });

  it("clears a line, keeping the others", async () => {
    const { db, row } = profileDb(sealPacked({ v: 1, lines: { c1: { tags: ["Party"] }, s1: { tags: ["School"] } } }, KEY));
    signIn(db);
    expect(await saveTransactionDetail("c1", {})).toMatchObject({ status: "saved", message: "Back to how the bank sent it." });
    expect(opened(row).lines).toEqual({ s1: { tags: ["School"] } });
  });

  it("marks what's owed paid back on the person's own today, and keeps it paid when the rest is edited", async () => {
    const { db, row } = profileDb(sealPacked({ v: 1, lines: { c1: { owed: { who: "Sam", amount: 7_500, paid: null } } } }, KEY));
    signIn(db);
    expect(await markOwedPaid("c1", true)).toMatchObject({ status: "saved", message: "Marked paid back by Sam." });
    expect(opened(row).lines).toEqual({ c1: { owed: { who: "Sam", amount: 7_500, paid: "2026-10-04" } } });
    await saveTransactionDetail("c1", { tags: ["Party"], owed: { who: "Sam", amount: 7_500, paid: null } });
    expect(opened(row).lines).toEqual({ c1: { tags: ["Party"], owed: { who: "Sam", amount: 7_500, paid: "2026-10-04" } } });
    expect(await markOwedPaid("c1", false)).toMatchObject({ status: "saved", message: "Open again: Sam still owes you." });
    expect(await markOwedPaid("s1", true)).toMatchObject({ status: "error", message: "Nobody owes you for that one." });
  });
});
