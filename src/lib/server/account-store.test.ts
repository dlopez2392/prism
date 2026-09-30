import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { liveCoinbaseToken, loadAccount, loadAccountCategoryRules, saveAccountCategoryRules, saveAccountFirstName } = await import("./account-store");
const { needsReseal, openJson, openPacked, sealJson, sealPacked, vaultKey } = await import("./vault");
const { openFeedSnapshot, sealFeedSnapshot } = await import("./feed-token");

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
      limit: () => builder,
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

describe("the name Prism greets you by", () => {
  it("is written to the person's own profile, and cleared with null", async () => {
    const upserts: { table: string; row: Row; options: unknown }[] = [];
    const db = { from: (table: string) => ({ upsert: async (row: Row, options: unknown) => (upserts.push({ table, row, options }), { error: null }) }) };
    await saveAccountFirstName(account(db), "María");
    await saveAccountFirstName(account(db), null);
    expect(upserts).toEqual([
      { table: "profiles", row: { user_id: "u1", first_name: "María" }, options: { onConflict: "user_id" } },
      { table: "profiles", row: { user_id: "u1", first_name: null }, options: { onConflict: "user_id" } },
    ]);
  });

  it("reports a refused write instead of pretending it saved", async () => {
    const db = { from: () => ({ upsert: async () => ({ error: { message: "denied" } }) }) };
    await expect(saveAccountFirstName(account(db), "Dan")).rejects.toThrow(/Couldn't save/);
  });
});

describe("a failed read", () => {
  const failing = { from: () => {
    const b = { select: () => b, eq: () => b, limit: () => b, returns: () => b, maybeSingle: async () => ({ data: null, error: { message: "JWT expired" } }), then: (r: (x: unknown) => void) => r({ data: null, error: { message: "JWT expired" } }) };
    return b;
  } };

  it("reads as an empty account in the app, but as an error for a connected app", async () => {
    await expect(loadAccount(account(failing), key)).resolves.toMatchObject({ items: [], coinbase: null, firstName: null });
    await expect(loadAccount(account(failing), key, { strict: true })).rejects.toThrow(/Couldn't read/);
  });
});

describe("a bank's stored sync", () => {
  const syncState = { v: 1 as const, cursor: "c9", ready: true, transactions: [{ transaction_id: "t1", account_id: "a1", amount: 4.5, date: "2026-09-20", name: "Corner Café", merchant_name: null, pending: false, personal_finance_category: null }] };

  it("opens with the linked bank, and a copy that won't open simply starts over", async () => {
    const { sealPacked } = await import("./vault");
    const row = (item_id: string, sealed_sync: string | null) => ({
      user_id: "u1", item_id, sealed_token: sealJson({ accessToken: `at-${item_id}` }, key), institution_id: null, institution_name: "Bank",
      linked_at: "2026-09-01T00:00:00Z", sealed_sync, sync_version: 3, synced_at: "2026-09-28T10:00:00Z", changed_at: null,
    });
    const { db } = fakeDb({ plaid_items: [row("good", sealPacked(syncState, key)), row("foreign", sealPacked(syncState, randomBytes(32)))] });
    const loaded = await loadAccount(account(db), key, { withSync: true });
    expect(loaded.plaidSync.get("good")).toEqual({ state: syncState, version: 3, syncedAt: "2026-09-28T10:00:00Z", changedAt: null });
    expect(loaded.plaidSync.get("foreign")).toEqual({ state: null, version: 3, syncedAt: null, changedAt: null });
    // A plan edit or a disconnect doesn't need (or open) any bank's copy.
    expect((await loadAccount(account(db), key)).plaidSync.size).toBe(0);
  });

  it("is saved sealed, and only over the version it started from", async () => {
    const { openPacked } = await import("./vault");
    const { saveAccountPlaidSync } = await import("./account-store");
    const updates: { values: Row; filters: Row }[] = [];
    const db = {
      from: () => {
        const filters: Row = {};
        let values: Row = {};
        const b = {
          update: (v: Row) => ((values = v), b),
          eq: (k: string, v: unknown) => ((filters[k] = v), b),
          select: async () => {
            updates.push({ values, filters: { ...filters } });
            return { data: filters.sync_version === 3 ? [{ item_id: "i1" }] : [], error: null };
          },
        };
        return b;
      },
    };
    expect(await saveAccountPlaidSync(account(db), "i1", syncState, key, 3, "2026-09-28T11:00:00Z")).toBe(true);
    expect(await saveAccountPlaidSync(account(db), "i1", syncState, key, 2, "2026-09-28T11:00:00Z")).toBe(false);
    const first = updates[0]!;
    expect(first.filters).toEqual({ user_id: "u1", item_id: "i1", sync_version: 3 });
    expect(first.values).toMatchObject({ sync_version: 4, synced_at: "2026-09-28T11:00:00Z" });
    expect(String(first.values.sealed_sync)).not.toContain("Corner");
    expect(openPacked(String(first.values.sealed_sync), key)).toEqual(syncState);
  });
});

describe("a shared Coinbase", () => {
  const withLink = (extra: Row = {}, shared = true) =>
    fakeDb({ coinbase_links: [{ ...coinbaseRow(1, 1, NOW + 3_600_000), ...extra }], shared_accounts: shared ? [{ user_id: "u1", account_id: "coinbase" }] : [] });

  it("says it's shared, and the value the household was last shown", async () => {
    const { db } = withLink({ sealed_snapshot: sealPacked({ v: 1, balance: 5_000 }, key), snapshot_at: "2026-09-30T01:00:00.000Z" });
    expect((await loadAccount(account(db), key)).coinbaseShared).toEqual({ balance: 5_000, at: "2026-09-30T01:00:00.000Z" });
  });

  it("before the first copy, has no value to compare", async () => {
    const { db } = withLink();
    expect((await loadAccount(account(db), key)).coinbaseShared).toEqual({ balance: null, at: null });
  });

  it("isn't shared when it isn't, or when Coinbase isn't connected at all", async () => {
    expect((await loadAccount(account(withLink({}, false).db), key)).coinbaseShared).toBeNull();
    const { db } = fakeDb({ coinbase_links: [], shared_accounts: [{ user_id: "u1", account_id: "coinbase" }] });
    expect((await loadAccount(account(db), key)).coinbaseShared).toBeNull();
  });

  it("treats a copy that won't open as no copy, so the next visit writes a fresh one", async () => {
    const { db } = withLink({ sealed_snapshot: sealPacked({ v: 1, balance: -3 }, key), snapshot_at: "2026-09-30T01:00:00.000Z" });
    expect((await loadAccount(account(db), key)).coinbaseShared).toEqual({ balance: null, at: null });
  });
});

describe("replacing the vault key", () => {
  const k1 = randomBytes(32);
  const k2 = randomBytes(32);
  const b64 = (k: Buffer) => k.toString("base64");
  const before = vaultKey({ PRISM_VAULT_KEY: b64(k1) })!;
  const during = vaultKey({ PRISM_VAULT_KEY: b64(k1), PRISM_VAULT_KEY_2: b64(k2) })!;
  const after = vaultKey({ PRISM_VAULT_KEY_2: b64(k2) })!;
  const sync = { v: 1, cursor: "c-9", ready: true, transactions: [{ transaction_id: "t1", account_id: "a1", amount: 4.5, date: "2026-09-01", pending: false }] };
  const bills = { bills: [{ name: "Rent", date: "2026-10-01" }] };
  const fixes = { v: 1, merchants: { "blue bottle": "food" }, transactions: { t9: "transfer" } };
  const owned = [{ id: "our-house", kind: "home", name: "Our house", values: [{ month: "2026-01", value: 35_000_000 }] }];
  const coinValue = { v: 1, balance: 123_456 };

  /** One person's account, everything in it sealed by `k` — as it stood before the key was replaced. */
  const sealedBy = (k: typeof before) => ({
    profiles: [{ user_id: "u1", first_name: "Dana", plan_budgets: null, plan_goals: null, sealed_category_rules: sealPacked(fixes, k), sealed_manual_items: sealPacked(owned, k), updated_at: "2026-09-29T10:00:00.000Z" }],
    plaid_items: [
      {
        user_id: "u1",
        item_id: "i1",
        sealed_token: sealJson({ accessToken: "access-1" }, k),
        institution_id: null,
        institution_name: "First Bank",
        linked_at: "2026-09-01",
        sealed_sync: sealPacked(sync, k),
        sync_version: 3,
        synced_at: "2026-09-02",
        changed_at: null,
      },
    ],
    coinbase_links: [
      {
        ...coinbaseRow(1, 4, NOW + 3_600_000),
        sealed_tokens: sealJson(tokens(1, NOW + 3_600_000), k),
        // Coinbase is shared with their household, so its value is kept too.
        sealed_snapshot: sealPacked(coinValue, k),
        snapshot_at: "2026-09-29T09:00:00.000Z",
      },
    ],
    shared_accounts: [{ user_id: "u1", account_id: "coinbase" }],
    calendar_feeds: [{ user_id: "u1", updated_at: "2026-09-02T00:00:00Z", sealed_token: sealJson({ token: "feed-secret" }, k), snapshot: sealFeedSnapshot(bills, k) }],
  });

  it("moves everything to the new key as the person uses Prism, so deleting the old key strands nothing", async () => {
    const { db, tables } = fakeDb(sealedBy(before));
    const a = await loadAccount(account(db), during, { withSync: true });
    // The visit itself works from the old seals.
    expect(a.items.map((i) => i.accessToken)).toEqual(["access-1"]);
    expect(a.plaidSync.get("i1")?.state).toEqual(sync);
    expect(a.coinbase?.tokens.accessToken).toBe("at1");
    expect(a.categories).toEqual(fixes);
    expect(a.manual).toEqual(owned);
    expect(a.coinbaseShared).toEqual({ balance: 123_456, at: "2026-09-29T09:00:00.000Z" });
    expect(a.reseal).not.toBeNull();
    await a.reseal!();

    const [item] = tables.plaid_items! as Row[];
    const [link] = tables.coinbase_links! as Row[];
    const [feed] = tables.calendar_feeds! as Row[];
    const [profile] = tables.profiles! as Row[];
    for (const sealed of [
      item!.sealed_token,
      item!.sealed_sync,
      link!.sealed_tokens,
      link!.sealed_snapshot,
      feed!.sealed_token,
      (feed!.snapshot as { sealed: string }).sealed,
      profile!.sealed_category_rules,
      profile!.sealed_manual_items,
    ]) {
      expect(needsReseal(sealed as string, during)).toBe(false);
    }
    // Versions never move, so a save made meanwhile can't be refused because of this.
    expect(item!.sync_version).toBe(3);
    expect(link!.version).toBe(4);
    // With the old key gone, every value still opens.
    expect(openJson(item!.sealed_token as string, after)).toEqual({ accessToken: "access-1" });
    expect(openPacked(item!.sealed_sync as string, after)).toEqual(sync);
    expect(openJson(link!.sealed_tokens as string, after)).toEqual(tokens(1, NOW + 3_600_000));
    expect(openPacked(link!.sealed_snapshot as string, after)).toEqual(coinValue);
    expect(link!.snapshot_at).toBe("2026-09-29T09:00:00.000Z");
    expect(openJson(feed!.sealed_token as string, after)).toEqual({ token: "feed-secret" });
    expect(openFeedSnapshot(feed!.snapshot, after)).toEqual(bills);
    expect(openPacked(profile!.sealed_category_rules as string, after)).toEqual(fixes);
    expect(openPacked(profile!.sealed_manual_items as string, after)).toEqual(owned);
    const later = await loadAccount(account(db), after, { withSync: true });
    expect(later.items.map((i) => i.accessToken)).toEqual(["access-1"]);
    expect(later.reseal).toBeNull();
  });

  it("writes nothing when everything is already under the current key", async () => {
    const { db, writes } = fakeDb(sealedBy(during));
    const a = await loadAccount(account(db), during, { withSync: true });
    expect(a.reseal).toBeNull();
    expect(writes).toEqual([]);
  });

  it("leaves the stored copy alone when only the bank token was read", async () => {
    const { db, writes } = fakeDb(sealedBy(before));
    await (await loadAccount(account(db), during)).reseal!();
    expect(writes.filter((w) => w.table === "plaid_items").map((w) => Object.keys(w.values!))).toEqual([["sealed_token"]]);
  });

  it("never overwrites a save made between the read and the reseal", async () => {
    const { db, tables } = fakeDb(sealedBy(before));
    const a = await loadAccount(account(db), during, { withSync: true });
    // Meanwhile: the bank is relinked, a new sync lands, and Coinbase refreshes (spending the old refresh token).
    const [item] = tables.plaid_items! as Row[];
    const [link] = tables.coinbase_links! as Row[];
    const relinked = sealJson({ accessToken: "access-2" }, during);
    const newer = sealPacked({ ...sync, cursor: "c-10" }, during);
    const refreshed = sealJson(tokens(2, NOW + 7_200_000), during);
    Object.assign(item!, { sealed_token: relinked, sealed_sync: newer, sync_version: 4 });
    // A newer Coinbase value is copied too (every copy moves snapshot_at).
    const newerValue = sealPacked({ v: 1, balance: 200_000 }, during);
    Object.assign(link!, { sealed_tokens: refreshed, version: 5, sealed_snapshot: newerValue, snapshot_at: "2026-09-29T10:00:00.000Z" });
    // …and a new category fix is saved (every profile write moves updated_at).
    const [profile] = tables.profiles! as Row[];
    const newFixes = sealPacked({ ...fixes, merchants: { ...fixes.merchants, "corner shop": "food" } }, during);
    Object.assign(profile!, { sealed_category_rules: newFixes, updated_at: "2026-09-29T10:00:05.000Z" });
    await a.reseal!();
    expect(item!.sealed_token).toBe(relinked);
    expect(item!.sealed_sync).toBe(newer);
    expect(link!.sealed_tokens).toBe(refreshed);
    expect(link!.sealed_snapshot).toBe(newerValue);
    expect(profile!.sealed_category_rules).toBe(newFixes);
  });

  it("never overwrites a Coinbase reconnect, which starts over at the same version", async () => {
    const { db, tables } = fakeDb(sealedBy(before));
    const [link] = tables.coinbase_links! as Row[];
    link!.version = 1;
    const a = await loadAccount(account(db), during);
    const reconnected = sealJson(tokens(7, NOW + 7_200_000), during);
    Object.assign(link!, { sealed_tokens: reconnected, version: 1 });
    await a.reseal!();
    expect(link!.sealed_tokens).toBe(reconnected);
  });

  it("moves both of the profile's sealed columns in one write, since a second would find the first had moved updated_at", async () => {
    const { db, writes } = fakeDb(sealedBy(before));
    await (await loadAccount(account(db), during)).reseal!();
    const profileWrites = writes.filter((w) => w.table === "profiles");
    expect(profileWrites).toHaveLength(1);
    expect(Object.keys(profileWrites[0]!.values!).sort()).toEqual(["sealed_category_rules", "sealed_manual_items"]);
  });

  it("changes nothing on a deploy without a rotation: no writes, and every seal in the format it had", async () => {
    const { db, writes, tables } = fakeDb(sealedBy(before));
    const [item] = tables.plaid_items! as Row[];
    expect(item!.sealed_token as string).not.toContain(".");
    expect((item!.sealed_sync as string).startsWith("z1.")).toBe(true);
    const a = await loadAccount(account(db), before, { withSync: true });
    expect(a.items.map((i) => i.accessToken)).toEqual(["access-1"]);
    expect(a.reseal).toBeNull();
    expect(writes).toEqual([]);
  });

  it("leaves a row no key opens exactly as it was", async () => {
    const stranger = vaultKey({ PRISM_VAULT_KEY: b64(randomBytes(32)) })!;
    const { db, writes } = fakeDb(sealedBy(stranger));
    const a = await loadAccount(account(db), during, { withSync: true });
    expect(a.items).toEqual([]);
    expect(a.reseal).toBeNull();
    expect(writes).toEqual([]);
  });
});

describe("category fixes in the account", () => {
  const fixes = { v: 1 as const, merchants: { "blue bottle": "food" as const }, transactions: {} };

  it("are stored sealed, so no merchant's name sits in the database in the clear, and cleared to nothing", async () => {
    const upserts: Row[] = [];
    const db = { from: () => ({ upsert: async (row: Row) => (upserts.push(row), { error: null }) }) };
    await saveAccountCategoryRules(account(db), fixes, key);
    await saveAccountCategoryRules(account(db), { v: 1, merchants: {}, transactions: {} }, key);
    const sealed = upserts[0]!.sealed_category_rules as string;
    expect(sealed).not.toContain("blue");
    expect(Buffer.from(sealed.slice(3), "base64url").toString("latin1")).not.toContain("blue bottle");
    expect(openPacked(sealed, key)).toEqual(fixes);
    expect(upserts[1]).toEqual({ user_id: "u1", sealed_category_rules: null });
  });

  it("are read strictly before a save: a failed read is an error, never 'no fixes' to write over", async () => {
    const broken = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "timeout" } }) }) }) }) };
    await expect(loadAccountCategoryRules(account(broken), key)).rejects.toThrow();
    const { db } = fakeDb({ profiles: [{ user_id: "u1", sealed_category_rules: sealPacked(fixes, key) }] });
    expect(await loadAccountCategoryRules(account(db), key)).toEqual(fixes);
  });
});
