import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { liveCoinbaseToken, loadAccount } = await import("./account-store");
const { sealJson } = await import("./vault");

const key = randomBytes(32);
const NOW = 1_790_000_000_000;
const config = { clientId: "c", clientSecret: "s", redirectUri: null, loginUrl: "https://login.example", apiUrl: "https://api.example" };

type Row = Record<string, unknown>;

/** Just enough of supabase-js's query builder to back the account store, over in-memory tables. */
function fakeDb(tables: Record<string, Row[]>) {
  const writes: { table: string; op: string; values?: Row; filters: Row }[] = [];
  const from = (table: string) => {
    const filters: Row = {};
    let op = "select";
    let values: Row | undefined;
    const match = () => (tables[table] ?? []).filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
    const builder = {
      select: () => builder,
      eq: (k: string, v: unknown) => ((filters[k] = v), builder),
      update: (v: Row) => ((op = "update"), (values = v), builder),
      returns: () => builder,
      maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
      then: (resolve: (x: unknown) => void) => {
        if (op === "update") {
          const hit = match();
          for (const r of hit) Object.assign(r, values);
          writes.push({ table, op, values, filters: { ...filters } });
          return resolve({ data: null, error: null, count: hit.length });
        }
        return resolve({ data: match(), error: null });
      },
    };
    return builder;
  };
  return { db: { from } as unknown, writes, tables };
}

const account = (db: unknown) => ({ supabase: db as never, userId: "u1", email: "a@x.test" });
const tokens = (n: number, expiresAt: number) => ({ accessToken: `at${n}`, refreshToken: `rt${n}`, expiresAt });
const coinbaseRow = (n: number, version: number, expiresAt: number) => ({
  user_id: "u1",
  sealed_tokens: sealJson(tokens(n, expiresAt), key),
  expires_at: new Date(expiresAt).toISOString(),
  version,
  linked_at: "2026-09-01T00:00:00.000Z",
});

describe("loadAccount", () => {
  it("opens this deployment's sealed tokens and ignores rows sealed under another key", async () => {
    const other = randomBytes(32);
    const { db } = fakeDb({
      profiles: [{ user_id: "u1", first_name: "Dana", plan_budgets: [{ category: "food", limit: 90_000 }], plan_goals: [{ junk: true }] }],
      plaid_items: [
        { user_id: "u1", item_id: "good", sealed_token: sealJson({ accessToken: "access-good" }, key), institution_id: "ins_1", institution_name: "First Bank", linked_at: "2026-09-01" },
        { user_id: "u1", item_id: "foreign", sealed_token: sealJson({ accessToken: "access-foreign" }, other), institution_id: null, institution_name: null, linked_at: "2026-09-01" },
      ],
      coinbase_links: [],
      calendar_feeds: [],
    });
    const a = await loadAccount(account(db), key);
    expect(a.firstName).toBe("Dana");
    expect(a.plan).toEqual({ budgets: [{ category: "food", limit: 90_000 }], goals: null });
    expect(a.items.map((i) => [i.itemId, i.accessToken])).toEqual([["good", "access-good"]]);
    expect(a.coinbase).toBeNull();
    expect(a.feedUpdatedAt).toBeNull();
  });
});

describe("liveCoinbaseToken", () => {
  const record = (version: number, expiresAt: number) => ({ tokens: tokens(1, expiresAt), version, linkedAt: "2026-09-01T00:00:00.000Z" });

  it("uses a fresh token as it is, touching nothing", async () => {
    const fetchImpl = vi.fn();
    const { db, writes } = fakeDb({ coinbase_links: [coinbaseRow(1, 1, NOW + 3_600_000)] });
    expect(await liveCoinbaseToken(account(db), record(1, NOW + 3_600_000), config, key, fetchImpl as unknown as typeof fetch, NOW)).toBe("at1");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("refreshes a lapsing token and stores the new pair only against the version it read", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: "at2", refresh_token: "rt2", expires_in: 3600 }), { status: 200 }));
    const { db, writes, tables } = fakeDb({ coinbase_links: [coinbaseRow(1, 1, NOW + 60_000)] });
    expect(await liveCoinbaseToken(account(db), record(1, NOW + 60_000), config, key, fetchImpl as unknown as typeof fetch, NOW)).toBe("at2");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.filters).toEqual({ user_id: "u1", version: 1 });
    expect(tables.coinbase_links![0]!.version).toBe(2);
  });

  it("when another request already refreshed, uses the pair it stored instead of failing", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 }));
    // The row already holds version 2, written by the request that won the race.
    const { db } = fakeDb({ coinbase_links: [coinbaseRow(2, 2, NOW + 3_600_000)] });
    expect(await liveCoinbaseToken(account(db), record(1, NOW + 60_000), config, key, fetchImpl as unknown as typeof fetch, NOW)).toBe("at2");
  });

  it("reports a dead link as null when nobody refreshed it", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 }));
    const { db } = fakeDb({ coinbase_links: [coinbaseRow(1, 1, NOW + 60_000)] });
    expect(await liveCoinbaseToken(account(db), record(1, NOW + 60_000), config, key, fetchImpl as unknown as typeof fetch, NOW)).toBeNull();
  });
});
