// The morning check (refresh.ts): the person's banks read again, as a visit
// reads them, with only balances and new transactions asked of Plaid; their
// wallets as last read, asking nobody; the bank's new copy kept only over the
// version read; a "morning" snapshot left for the email; and nothing at all
// when the database won't hand the sources over or nothing of theirs is live.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaidAccount } from "@/lib/plaid/client";
import { openPacked, sealJson, sealPacked } from "@/lib/server/vault";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: () => undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, has: () => false }), headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => null }));

const { morningCheck } = await import("./refresh");
const { alertsConfig } = await import("./send");

const KEY = randomBytes(32);
const config = alertsConfig({ RESEND_API_KEY: "re_test", CRON_SECRET: "s".repeat(44) })!;
const U = "11111111-1111-4111-8111-111111111111";
// 03:00 UTC on Oct 6 is still the evening of Oct 5 in Chicago: their day, not the server's.
const NOW = new Date("2026-10-06T03:00:00Z");
const BTC = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";

const checking: PlaidAccount = { account_id: "chk", name: "Checking", official_name: null, mask: "0001", type: "depository", subtype: "checking", balances: { available: 900, current: 900, iso_currency_code: "USD" } };
const brokerage: PlaidAccount = { account_id: "inv", name: "Brokerage", official_name: null, mask: "0002", type: "investment", subtype: "brokerage", balances: { available: null, current: 5000, iso_currency_code: "USD" } };
const card: PlaidAccount = { account_id: "cc", name: "Card", official_name: null, mask: "0003", type: "credit", subtype: "credit card", balances: { available: 100, current: 400, iso_currency_code: "USD" } };
const coffee = { transaction_id: "t-new", account_id: "chk", amount: 4.5, date: "2026-10-05", name: "Corner Coffee", merchant_name: "Corner Coffee", pending: false, personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE" } };

/** Plaid answering, and a record of every address asked. */
const asked: string[] = [];
const fetchAll = vi.fn(async (url: RequestInfo | URL) => {
  const u = new URL(String(url));
  asked.push(`${u.host}${u.pathname}`);
  if (u.pathname === "/accounts/get") return Response.json({ accounts: [checking, brokerage, card], item: { institution_id: null } });
  if (u.pathname === "/transactions/sync")
    return Response.json({ added: [coffee], modified: [], removed: [], next_cursor: "c-2", has_more: false, transactions_update_status: "HISTORICAL_UPDATE_COMPLETE" });
  return Response.json({ error_code: "NOT_FOUND" }, { status: 404 });
});

function sources(over: Record<string, unknown> = {}) {
  return {
    time_zone: "America/Chicago",
    plan_budgets: null,
    plan_goals: null,
    sealed_category_rules: null,
    sealed_manual_items: null,
    sealed_wallets: sealPacked({ v: 1, wallets: [{ id: "a1b2c3d4e5f6", chain: "bitcoin", address: BTC, name: "Cold storage", reading: { at: "2026-09-01T00:00:00.000Z", assets: [] } }] }, KEY),
    banks: [
      {
        item_id: "item-1",
        sealed_token: sealJson({ accessToken: "access-production-1" }, KEY),
        institution_id: null,
        institution_name: "First Bank",
        linked_at: "2026-09-28",
        sealed_sync: sealPacked({ v: 1, cursor: "c-1", ready: true, accounts: [checking], transactions: [] }, KEY),
        sync_version: 3,
        synced_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        changed_at: null,
        attention: null,
        disconnect_at: null,
      },
    ],
    imports: [],
    ...over,
  };
}

function fakeDb(data: unknown) {
  const calls: [string, Record<string, unknown>][] = [];
  return {
    calls,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      if (fn === "alerts_sources") return { data, error: null };
      return { data: true, error: null };
    },
  };
}

describe("the morning check", () => {
  beforeEach(() => {
    vi.stubEnv("PLAID_CLIENT_ID", "id");
    vi.stubEnv("PLAID_SECRET", "secret");
    vi.stubEnv("PLAID_LIABILITIES", "on");
    vi.stubGlobal("fetch", fetchAll);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchAll.mockClear();
    asked.length = 0;
  });

  it("reads the person's banks again and leaves a morning snapshot of their own day", async () => {
    const db = fakeDb(sources());
    const snap = await morningCheck(db, config, KEY, U, NOW);
    expect(snap).toMatchObject({ v: 1, by: "morning", today: "2026-10-05", at: NOW.toISOString() });
    expect(db.calls[0]).toEqual(["alerts_sources", { p_secret: config.secret, p_user_id: U }]);
    const [, kept] = db.calls.find(([fn]) => fn === "alerts_save_snapshot")!;
    expect(kept).toMatchObject({ p_secret: config.secret, p_user_id: U });
    expect(openPacked(kept.p_sealed as string, KEY)).toEqual(snap);
  });

  it("asks Plaid for balances and new transactions only: no holdings, no card terms, and asks no one about wallets", async () => {
    await morningCheck(fakeDb(sources()), config, KEY, U, NOW);
    expect(asked.map((a) => a.replace(/^[^/]+/, "")).sort()).toEqual(["/accounts/get", "/transactions/sync"]);
    expect(asked.every((a) => a.endsWith("plaid.com/accounts/get") || a.endsWith("plaid.com/transactions/sync"))).toBe(true);
  });

  it("keeps the bank's new copy only over the version it read, stamped with when the read began", async () => {
    const db = fakeDb(sources());
    await morningCheck(db, config, KEY, U, NOW);
    const [, saved] = db.calls.find(([fn]) => fn === "alerts_save_sync")!;
    expect(saved).toMatchObject({ p_secret: config.secret, p_user_id: U, p_item_id: "item-1", p_from_version: 3, p_synced_at: expect.any(String) });
    const copy = openPacked(saved.p_sealed_sync as string, KEY) as { cursor: string; transactions: { transaction_id: string }[] };
    expect(copy.cursor).toBe("c-2");
    expect(copy.transactions.map((t) => t.transaction_id)).toEqual(["t-new"]);
  });

  it("does nothing when the database won't hand the sources over", async () => {
    const db = fakeDb(null);
    expect(await morningCheck(db, config, KEY, U, NOW)).toBeNull();
    expect(db.calls.map(([fn]) => fn)).toEqual(["alerts_sources"]);
    expect(fetchAll).not.toHaveBeenCalled();
  });

  it("never snapshots the example household: with nothing of theirs live, nothing is kept", async () => {
    const db = fakeDb(sources({ banks: [], sealed_wallets: null }));
    expect(await morningCheck(db, config, KEY, U, NOW)).toBeNull();
    expect(db.calls.map(([fn]) => fn)).toEqual(["alerts_sources"]);
  });

  it("skips a bank whose token won't open under the ring, as a visit does", async () => {
    const other = randomBytes(32);
    const banks = [{ ...sources().banks[0], sealed_token: sealJson({ accessToken: "access-production-1" }, other) }];
    const db = fakeDb(sources({ banks }));
    const snap = await morningCheck(db, config, KEY, U, NOW);
    // The wallet alone is still theirs, so a snapshot is kept; the bank was never asked about.
    expect(snap?.by).toBe("morning");
    expect(fetchAll).not.toHaveBeenCalled();
    expect(db.calls.some(([fn]) => fn === "alerts_save_sync")).toBe(false);
  });

  it("fails loudly when the database can't be asked", async () => {
    const db = { rpc: async () => ({ data: null, error: { message: "not allowed" } }) };
    await expect(morningCheck(db, config, KEY, U, NOW)).rejects.toThrow(/sources/);
  });
});
