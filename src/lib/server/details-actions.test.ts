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

const { saveTransactionDetail, markOwedPaid, setSplitRule } = await import("./details-actions");
const { openPacked, sealPacked } = await import("./vault");

const KEY = randomBytes(32);
const txn = (id: string, amount: number, merchant: string, category: Transaction["category"], over: Partial<Transaction> = {}): Transaction => ({ id, accountId: "chk", date: "2026-09-20", amount, merchant, category, pending: false, ...over });
const MINE = [
  txn("c1", -15_000, "Costco", "food"),
  txn("c2", -20_000, "COSTCO #482", "food"),
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
const opened = (row: { sealed_txn_details: string | null }) => openPacked(row.sealed_txn_details!, KEY) as { lines: Record<string, unknown>; rules?: Record<string, unknown> };
const COSTCO = { name: "Costco", split: [{ category: "food", share: 6_000 }, { category: "shopping", share: 4_000 }] };

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

  it("keeps a split for every purchase at the shop, as shares, and this one follows it", async () => {
    const { db, row } = profileDb(null);
    signIn(db);
    expect(await saveTransactionDetail("c1", { ...SPLIT, tags: ["Party"], rule: true })).toMatchObject({ status: "saved", message: "Split into 2 parts, and so is every Costco purchase." });
    expect(opened(row)).toEqual({ v: 1, lines: { c1: { tags: ["Party"] } }, rules: { costco: COSTCO } });
    // Another branch's spelling is the same shop; kept whole, it says the others still follow.
    expect(await saveTransactionDetail("c2", {})).toMatchObject({ status: "saved", message: "Kept whole. Other COSTCO #482 purchases still follow your split." });
    expect(opened(row).lines).toEqual({ c1: { tags: ["Party"] }, c2: { whole: true } });
  });

  it("keeps a shop's split made from a purchase with nothing else to keep", async () => {
    const { db, row } = profileDb(null);
    signIn(db);
    // No tags, nobody owes: this line keeps nothing of its own, and the shop's split is all there is.
    expect(await saveTransactionDetail("c1", { ...SPLIT, rule: true })).toMatchObject({ status: "saved", message: "Split into 2 parts, and so is every Costco purchase." });
    expect(opened(row)).toEqual({ v: 1, lines: {}, rules: { costco: COSTCO } });
  });

  it("keeps the shops' splits when the last line's own details are cleared", async () => {
    const { db, row } = profileDb(sealPacked({ v: 1, lines: { pay: { tags: ["Bonus"] } }, rules: { costco: COSTCO } }, KEY));
    signIn(db);
    expect(await saveTransactionDetail("pay", {})).toMatchObject({ status: "saved", message: "Back to how the bank sent it." });
    expect(opened(row)).toEqual({ v: 1, lines: {}, rules: { costco: COSTCO } });
  });

  it("takes the shop's split away when the box is unticked, keeping this one's own", async () => {
    const { db, row } = profileDb(sealPacked({ v: 1, lines: {}, rules: { costco: COSTCO } }, KEY));
    signIn(db);
    expect(await saveTransactionDetail("c1", { ...SPLIT, rule: false })).toMatchObject({ status: "saved", message: "Split into 2 parts. Other Costco purchases aren't split any more." });
    expect(opened(row)).toEqual({ v: 1, lines: { c1: { split: SPLIT.split } } });
  });

  it("leaves the shop's split alone when a save doesn't say either way", async () => {
    const { db, row } = profileDb(sealPacked({ v: 1, lines: {}, rules: { costco: COSTCO } }, KEY));
    signIn(db);
    expect(await saveTransactionDetail("c1", SPLIT)).toMatchObject({ status: "saved", message: "Split into 2 parts. Every total now counts them that way." });
    expect(opened(row)).toEqual({ v: 1, lines: { c1: { split: SPLIT.split } }, rules: { costco: COSTCO } });
  });

  it("won't keep a shop's split with a part too small for a share of it", async () => {
    const { db, writes } = profileDb(null);
    signIn(db);
    // Three one-cent parts of $150 and two hundredths of a percent left over: one of them gets none.
    const tiny = { split: [{ category: "food", amount: 14_997 }, { category: "shopping", amount: 1 }, { category: "fun", amount: 1 }, { category: "health", amount: 1 }], rule: true };
    expect(await saveTransactionDetail("c1", tiny)).toMatchObject({ status: "error", message: expect.stringMatching(/too small/) });
    expect(writes).toEqual([]);
  });

  it("removes a shop's split from the list, and puts it back for Undo, only as a whole valid split", async () => {
    const { db, row, writes } = profileDb(sealPacked({ v: 1, lines: { c1: { tags: ["Party"] } }, rules: { costco: COSTCO } }, KEY));
    expect(await setSplitRule("costco", null)).toMatchObject({ status: "error", message: expect.stringMatching(/Sign in/) });
    signIn(db);
    expect(await setSplitRule("costco", null)).toMatchObject({ status: "saved", message: expect.stringMatching(/back to how the bank sent them/) });
    expect(opened(row)).toEqual({ v: 1, lines: { c1: { tags: ["Party"] } } });
    expect(await setSplitRule("costco", COSTCO)).toMatchObject({ status: "saved", message: "Every Costco purchase is split again." });
    expect(opened(row).rules).toEqual({ costco: COSTCO });
    const count = writes.length;
    expect(await setSplitRule("COSTCO", null)).toMatchObject({ status: "error" });
    expect(await setSplitRule("COSTCO #482", COSTCO)).toMatchObject({ status: "error", message: expect.stringMatching(/isn't one of yours/) });
    expect(await setSplitRule("costco", { ...COSTCO, split: [{ category: "food", share: 6_000 }, { category: "shopping", share: 3_000 }] })).toMatchObject({ status: "error", message: expect.stringMatching(/add up/) });
    expect(await setSplitRule("target", null)).toMatchObject({ status: "error", message: expect.stringMatching(/no split/) });
    expect(await setSplitRule(7, null)).toMatchObject({ status: "error" });
    expect(writes).toHaveLength(count);
  });

  it("puts back the only shop's split there was, and clears the column once nothing is left", async () => {
    const { db, row } = profileDb(sealPacked({ v: 1, lines: {}, rules: { costco: COSTCO } }, KEY));
    signIn(db);
    expect(await setSplitRule("costco", null)).toMatchObject({ status: "saved" });
    expect(row.sealed_txn_details).toBeNull();
    expect(await setSplitRule("costco", COSTCO)).toMatchObject({ status: "saved", message: "Every Costco purchase is split again." });
    expect(opened(row)).toEqual({ v: 1, lines: {}, rules: { costco: COSTCO } });
  });
});
