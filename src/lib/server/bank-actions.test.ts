// A finished "Sign in again" (bank-actions.ts, account-store.ts): whatever
// Plaid warned about that bank is cleared, on the person's own row only, and
// the bank is marked as news so the next page reads it afresh. A mere sync
// clears only a sign-in or a withdrawal, never a consent still running out.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const signedIn = { current: null as unknown };
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => signedIn.current }));

const { bankSignedInAgain } = await import("./bank-actions");
const { clearBankAttention } = await import("./account-store");

/** A Supabase query that records what it was asked. */
function fakeDb() {
  const calls: unknown[][] = [];
  const query = {
    update: (values: unknown) => (calls.push(["update", values]), query),
    eq: (col: string, v: unknown) => (calls.push(["eq", col, v]), query),
    in: (col: string, v: unknown) => (calls.push(["in", col, v]), query),
    not: (col: string, op: string, v: unknown) => (calls.push(["not", col, op, v]), query),
    then: (resolve: (r: { error: null }) => unknown) => resolve({ error: null }),
  };
  return { calls, supabase: { from: (t: string) => (calls.push(["from", t]), query) } };
}

afterEach(() => {
  signedIn.current = null;
});

describe("signing in to a bank again", () => {
  it("clears that bank's warning, whatever it was, and marks it as news", async () => {
    const db = fakeDb();
    signedIn.current = { userId: "u1", email: "a@x.test", supabase: db.supabase };
    await bankSignedInAgain("item-1");
    const [from, update, ...where] = db.calls;
    expect(from).toEqual(["from", "plaid_items"]);
    expect(update![1]).toMatchObject({ attention: null, attention_at: null, disconnect_at: null, changed_at: expect.any(String) });
    expect(where).toEqual([
      ["eq", "user_id", "u1"],
      ["eq", "item_id", "item-1"],
      ["not", "attention", "is", null],
    ]);
  });

  it("does nothing for someone signed out, or for an id that isn't one", async () => {
    const db = fakeDb();
    await bankSignedInAgain("item-1");
    signedIn.current = { userId: "u1", email: "a@x.test", supabase: db.supabase };
    await bankSignedInAgain("item-1' or 1=1 --");
    await bankSignedInAgain(42 as never);
    expect(db.calls).toEqual([]);
  });

  it("after a mere sync, clears only a sign-in or a withdrawal, and doesn't mark the bank as news", async () => {
    const db = fakeDb();
    await clearBankAttention({ userId: "u1", email: "a@x.test", supabase: db.supabase } as never, "item-1", { only: ["sign-in", "revoked"] });
    expect(db.calls[1]).toEqual(["update", { attention: null, attention_at: null, disconnect_at: null }]);
    expect(db.calls.at(-1)).toEqual(["in", "attention", ["sign-in", "revoked"]]);
  });
});
