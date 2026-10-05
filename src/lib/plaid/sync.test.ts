import { describe, expect, it, vi } from "vitest";
import type { PlaidConfig, PlaidTransaction } from "./client";
import { applyPage, FRESH_MS, holdingsOnly, needsSync, syncTransactions, validState, type SyncState } from "./sync";

const config: PlaidConfig = { clientId: "c", secret: "s", env: "sandbox", host: "https://plaid.test" };
const TODAY = "2026-09-28";

const tx = (id: string, amount: number, extra: Partial<PlaidTransaction> = {}): PlaidTransaction => ({
  transaction_id: id,
  account_id: "acc-1",
  amount,
  date: "2026-09-10",
  name: `Shop ${id}`,
  merchant_name: null,
  pending: false,
  personal_finance_category: { primary: "GENERAL_MERCHANDISE", detailed: "GENERAL_MERCHANDISE_OTHER" },
  ...extra,
});

type Page = { added?: PlaidTransaction[]; modified?: PlaidTransaction[]; removed?: string[]; next: string; more?: boolean; status?: string; error?: string };

/** A strict fake of Plaid's /transactions/sync: answers by the cursor it's handed, and records every call. */
function fakePlaid(pages: Record<string, Page | Page[]>) {
  const calls: { cursor: string | undefined; count: number }[] = [];
  const seen: Record<string, number> = {};
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toBe("https://plaid.test/transactions/sync");
    const body = JSON.parse(String(init?.body)) as { cursor?: string; count: number; access_token: string };
    expect(body.access_token).toBe("access-1");
    calls.push({ cursor: body.cursor, count: body.count });
    const key = body.cursor ?? "";
    const entry = pages[key];
    if (!entry) return Response.json({ error_code: "INVALID_FIELD", error_message: `no page for ${key}` }, { status: 400 });
    const n = (seen[key] = (seen[key] ?? 0) + 1);
    const page = Array.isArray(entry) ? entry[Math.min(n, entry.length) - 1]! : entry;
    if (page.error) return Response.json({ error_code: page.error, error_message: "mutated" }, { status: 400 });
    return Response.json({
      added: page.added ?? [],
      modified: page.modified ?? [],
      removed: (page.removed ?? []).map((transaction_id) => ({ transaction_id, account_id: "acc-1" })),
      next_cursor: page.next,
      has_more: page.more ?? false,
      transactions_update_status: page.status,
    });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("accounts with no transactions to give", () => {
  it("are those that only hold investments: a bank or card alongside them still has its transactions", () => {
    expect(holdingsOnly([{ type: "investment" }])).toBe(true);
    expect(holdingsOnly([{ type: "investment" }, { type: "brokerage" }])).toBe(true);
    expect(holdingsOnly([{ type: "investment" }, { type: "depository" }])).toBe(false);
    expect(holdingsOnly([{ type: "credit" }])).toBe(false);
    // No accounts at all is something wrong, never a brokerage.
    expect(holdingsOnly([])).toBe(false);
  });
});

describe("the first sync", () => {
  it("pages through the whole history and keeps the last cursor", async () => {
    const plaid = fakePlaid({
      "": { added: [tx("t1", 10), tx("t2", 20)], next: "c1", more: true, status: "HISTORICAL_UPDATE_COMPLETE" },
      c1: { added: [tx("t3", 30)], next: "c2" },
    });
    const state = await syncTransactions(config, "access-1", null, { today: TODAY, fetchImpl: plaid.fetchImpl });
    expect(state.cursor).toBe("c2");
    expect(state.transactions.map((t) => t.transaction_id).sort()).toEqual(["t1", "t2", "t3"]);
    expect(state.ready).toBe(true);
    expect(plaid.calls).toEqual([
      { cursor: undefined, count: 500 },
      { cursor: "c1", count: 500 },
    ]);
  });

  it("says when Plaid hasn't finished its first pull", async () => {
    const plaid = fakePlaid({ "": { next: "c0", status: "NOT_READY" } });
    expect((await syncTransactions(config, "access-1", null, { today: TODAY, fetchImpl: plaid.fetchImpl })).ready).toBe(false);
  });
});

describe("a later sync", () => {
  const before: SyncState = { v: 1, cursor: "c2", ready: true, transactions: [tx("t1", 10), tx("p1", 45, { pending: true })] };

  it("asks only for what changed since the cursor, and applies it", async () => {
    const plaid = fakePlaid({
      // The pending charge posts under a new id; t1's amount is corrected; one new charge.
      c2: { added: [tx("p1-posted", 45.5), tx("t4", 5)], modified: [tx("t1", 11)], removed: ["p1"], next: "c3" },
    });
    const next = await syncTransactions(config, "access-1", before, { today: TODAY, fetchImpl: plaid.fetchImpl });
    expect(plaid.calls).toEqual([{ cursor: "c2", count: 500 }]);
    expect(next.cursor).toBe("c3");
    expect(Object.fromEntries(next.transactions.map((t) => [t.transaction_id, t.amount]))).toEqual({ t1: 11, "p1-posted": 45.5, t4: 5 });
    // The copy it started from is untouched.
    expect(before.transactions.map((t) => t.transaction_id)).toEqual(["t1", "p1"]);
  });

  it("starts the whole pass again from ITS cursor when the bank's data moves mid-read — keeping nothing from the aborted pass", async () => {
    const plaid = fakePlaid({
      // The first read of page one saw a charge that the bank then withdrew; the second read doesn't have it.
      c2: [{ added: [tx("withdrawn", 1)], next: "c2b", more: true }, { added: [tx("kept", 2)], next: "c2b", more: true }],
      c2b: [{ error: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", next: "" }, { added: [tx("t5", 7)], next: "c3" }],
    });
    const next = await syncTransactions(config, "access-1", before, { today: TODAY, fetchImpl: plaid.fetchImpl });
    expect(plaid.calls.map((c) => c.cursor)).toEqual(["c2", "c2b", "c2", "c2b"]);
    expect(next.cursor).toBe("c3");
    expect(next.transactions.map((t) => t.transaction_id).sort()).toEqual(["kept", "p1", "t1", "t5"]);
  });

  it("starts over from no cursor when Plaid refuses the saved one, rather than staying stuck on the old copy", async () => {
    const plaid = fakePlaid({
      c2: { error: "INVALID_FIELD", next: "" },
      "": { added: [tx("t1", 10), tx("t9", 9)], next: "c7", status: "HISTORICAL_UPDATE_COMPLETE" },
    });
    const next = await syncTransactions(config, "access-1", before, { today: TODAY, fetchImpl: plaid.fetchImpl });
    expect(plaid.calls.map((c) => c.cursor)).toEqual(["c2", undefined]);
    expect(next.cursor).toBe("c7");
    // A fresh read replaces the old copy outright: p1 was never re-sent, so it's gone.
    expect(next.transactions.map((t) => t.transaction_id).sort()).toEqual(["t1", "t9"]);
  });

  it("doesn't start over for problems a new cursor can't fix", async () => {
    const plaid = fakePlaid({ c2: { error: "ITEM_LOGIN_REQUIRED", next: "" } });
    await expect(syncTransactions(config, "access-1", before, { today: TODAY, fetchImpl: plaid.fetchImpl })).rejects.toMatchObject({ code: "ITEM_LOGIN_REQUIRED" });
    expect(plaid.calls.map((c) => c.cursor)).toEqual(["c2"]);
  });

  it("fails rather than keep half a history when Plaid never runs out of pages", async () => {
    const endless: Record<string, Page> = {};
    for (let i = 0; i < 250; i++) endless[i === 0 ? "c2" : `e${i}`] = { added: [tx(`x${i}`, 1)], next: `e${i + 1}`, more: true };
    const plaid = fakePlaid(endless);
    await expect(syncTransactions(config, "access-1", before, { today: TODAY, fetchImpl: plaid.fetchImpl })).rejects.toMatchObject({ code: "SYNC_INCOMPLETE" });
    expect(plaid.calls.length).toBe(200);
  });

  it("keeps the balances it was given along with the transactions", async () => {
    const accounts = [{ account_id: "acc-1", name: "Checking", official_name: null, mask: "0001", type: "depository" as const, subtype: "checking", balances: { available: 10, current: 10, iso_currency_code: "USD" } }];
    const plaid = fakePlaid({ c2: { next: "c3" } });
    const next = await syncTransactions(config, "access-1", { ...before, accounts }, { today: TODAY, fetchImpl: plaid.fetchImpl });
    expect(next.accounts).toEqual(accounts);
    expect(validState(next)).toEqual(next);
    expect(validState({ ...next, accounts: [{ nope: true }] })).toBeNull();
  });

  it("gives up after a few restarts rather than looping forever", async () => {
    const plaid = fakePlaid({ c2: { error: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", next: "" } });
    await expect(syncTransactions(config, "access-1", before, { today: TODAY, fetchImpl: plaid.fetchImpl })).rejects.toMatchObject({ code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" });
    expect(plaid.calls.length).toBe(4);
  });

  it("stays ready when a quiet page doesn't repeat the status", async () => {
    const plaid = fakePlaid({ c2: { next: "c3" } });
    expect((await syncTransactions(config, "access-1", before, { today: TODAY, fetchImpl: plaid.fetchImpl })).ready).toBe(true);
  });

  it("lets go of anything older than 25 months, so a copy can't grow forever", async () => {
    const old: SyncState = { ...before, transactions: [tx("ancient", 1, { date: "2024-06-01" }), tx("t1", 10)] };
    const plaid = fakePlaid({ c2: { next: "c3" } });
    const next = await syncTransactions(config, "access-1", old, { today: TODAY, fetchImpl: plaid.fetchImpl });
    expect(next.transactions.map((t) => t.transaction_id)).toEqual(["t1"]);
  });
});

describe("what is kept", () => {
  it("only the fields Prism reads", () => {
    const byId = new Map<string, PlaidTransaction>();
    applyPage(byId, { added: [{ ...tx("t1", 1), location: { city: "Austin" }, payment_meta: { payee: "x" } } as unknown as PlaidTransaction], modified: [], removed: [] });
    expect(Object.keys(byId.get("t1")!).sort()).toEqual(["account_id", "amount", "date", "merchant_name", "name", "pending", "personal_finance_category", "transaction_id"]);
  });

  it("reads a stored copy only if it is one", () => {
    const good: SyncState = { v: 1, cursor: "c", ready: true, transactions: [tx("t1", 1)] };
    expect(validState(good)).toEqual(good);
    for (const bad of [null, {}, { ...good, v: 2 }, { ...good, cursor: 5 }, { ...good, transactions: [{ transaction_id: "t" }] }, { ...good, ready: "yes" }]) {
      expect(validState(bad)).toBeNull();
    }
  });
});

describe("when to ask Plaid again", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const state: SyncState = { v: 1, cursor: "c", ready: true, transactions: [] };
  const at = (min: number) => new Date(now - min * 60_000).toISOString();

  it("not while the copy is fresh and Plaid has been quiet", () => {
    expect(needsSync({ state, version: 1, syncedAt: at(5), changedAt: null }, now)).toBe(false);
    expect(needsSync({ state, version: 1, syncedAt: at(5), changedAt: at(9) }, now)).toBe(false);
  });

  it("when Plaid has news since, the copy has aged, Plaid wasn't done, or there's no copy", () => {
    expect(needsSync({ state, version: 1, syncedAt: at(5), changedAt: at(1) }, now)).toBe(true);
    expect(needsSync({ state, version: 1, syncedAt: at(FRESH_MS / 60_000 + 1), changedAt: null }, now)).toBe(true);
    expect(needsSync({ state: { ...state, ready: false }, version: 1, syncedAt: at(1), changedAt: null }, now)).toBe(true);
    expect(needsSync({ state: null, version: 0, syncedAt: null, changedAt: null }, now)).toBe(true);
    expect(needsSync(null, now)).toBe(true);
  });
});
