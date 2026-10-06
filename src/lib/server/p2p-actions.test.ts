// Keeping payment notes (p2p-actions.ts): only for a signed-in account, only
// on the person's own lines from that app, sealed, merged with what's there,
// and never over notes it couldn't read.

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

const { saveP2pMatches, removeP2pNotes } = await import("./p2p-actions");
const { openPacked, sealPacked } = await import("./vault");

const KEY = randomBytes(32);

const txn = (id: string, date: string, amount: number, merchant: string): Transaction => ({ id, accountId: "chk", date, amount, merchant, category: "transfer", pending: false });
const MINE = [txn("v1", "2026-09-13", -4500, "Venmo"), txn("v2", "2026-09-16", 50000, "VENMO CASHOUT"), txn("s1", "2026-09-13", -4500, "Starbucks")];
const pizza = { txnId: "v1", app: "venmo", dir: "to", name: "Alex Kim", note: "pizza", date: "2026-09-12" };
const cashout = { txnId: "v2", app: "venmo", dir: "transfer", name: "Moved to your bank", note: null, date: "2026-09-15" };

function profileDb(stored: string | null, { readFails = false } = {}) {
  const row = { sealed_p2p_notes: stored };
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

describe("keeping payment notes", () => {
  beforeEach(() => {
    vi.stubEnv("PRISM_VAULT_KEY", KEY.toString("base64"));
    money.current = { source: "plaid", transactions: MINE };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    signedIn.current = null;
  });

  it("needs a signed-in account", async () => {
    expect(await saveP2pMatches([pizza])).toMatchObject({ status: "error", message: expect.stringMatching(/Sign in/) });
  });

  it("keeps the matches, sealed, and says how many", async () => {
    const { db, row } = profileDb(null);
    signIn(db);
    expect(await saveP2pMatches([pizza, cashout])).toMatchObject({ status: "saved", saved: 2, message: "2 payments now say who each was for." });
    expect(row.sealed_p2p_notes).not.toContain("Alex");
    expect(openPacked(row.sealed_p2p_notes, KEY)).toEqual({
      v: 1,
      notes: { v1: { app: "venmo", dir: "to", name: "Alex Kim", note: "pizza", date: "2026-09-12" }, v2: { app: "venmo", dir: "transfer", name: "Moved to your bank", note: null, date: "2026-09-15" } },
    });
  });

  it("drops what isn't the person's own line from that app, and says so", async () => {
    const { db, row } = profileDb(null);
    signIn(db);
    const res = await saveP2pMatches([pizza, { ...pizza, txnId: "s1" }, { ...pizza, txnId: "not-mine" }, { ...pizza, dir: "from" }, "junk"]);
    expect(res).toMatchObject({ status: "saved", saved: 1, message: "1 payment now says who it was for. 4 no longer matched your accounts, so they were left out." });
    expect(Object.keys((openPacked(row.sealed_p2p_notes, KEY) as { notes: object }).notes)).toEqual(["v1"]);
  });

  it("adds to the notes already there", async () => {
    const { db, row } = profileDb(sealPacked({ v: 1, notes: { v2: { ...cashout, txnId: undefined } } }, KEY));
    signIn(db);
    await saveP2pMatches([pizza]);
    expect(Object.keys((openPacked(row.sealed_p2p_notes, KEY) as { notes: object }).notes).sort()).toEqual(["v1", "v2"]);
  });

  it("never writes over notes it couldn't read", async () => {
    const { db, writes } = profileDb(null, { readFails: true });
    signIn(db);
    expect(await saveP2pMatches([pizza])).toMatchObject({ status: "error" });
    expect(writes).toEqual([]);
  });

  it("refuses the example household, nothing to match, and too much at once", async () => {
    const { db, writes } = profileDb(null);
    signIn(db);
    money.current = { source: "demo", transactions: MINE };
    expect(await saveP2pMatches([pizza])).toMatchObject({ status: "error", message: expect.stringMatching(/Link the bank/) });
    money.current = { source: "plaid", transactions: MINE };
    expect(await saveP2pMatches([])).toMatchObject({ status: "error" });
    expect(await saveP2pMatches("v1")).toMatchObject({ status: "error" });
    expect(await saveP2pMatches(Array.from({ length: 3001 }, () => pizza))).toMatchObject({ status: "error", message: expect.stringMatching(/more than 3,000/) });
    expect(await saveP2pMatches([{ ...pizza, txnId: "s1" }])).toMatchObject({ status: "error", message: expect.stringMatching(/None of those/) });
    expect(writes).toEqual([]);
  });

  it("forgets them all on request", async () => {
    const { db, row } = profileDb(sealPacked({ v: 1, notes: { v1: pizza } }, KEY));
    signIn(db);
    expect(await removeP2pNotes()).toMatchObject({ status: "saved", message: expect.stringMatching(/gone/) });
    expect(row.sealed_p2p_notes).toBeNull();
  });
});
