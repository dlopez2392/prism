// The account schema, proven as each role would meet it. Every migration is
// applied to an in-memory Postgres (PGlite) with stand-ins for the pieces of
// Supabase it relies on — the auth.users table, auth.uid(), and the anon and
// authenticated roles with Supabase's default grants — so a policy mistake
// fails here, in CI, before it can reach the real database.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const SEALED = "x".repeat(40);
let db: PGlite;

const rows = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows;
const refused = async (sql: string, params: unknown[] = []) => rows(sql, params).then(() => false, () => true);

async function as<T>(role: "anon" | "authenticated", sub: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
  `);
  const dir = new URL("../../../supabase/migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await db.exec(readFileSync(new URL(file, dir), "utf8"));
  await rows(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'a@x.test', '{"first_name":"Dana"}'), ($2, 'b@x.test', $3)`, [A, B, JSON.stringify({ first_name: "x".repeat(60) })]);
  await rows(`insert into public.plaid_items (user_id, item_id, sealed_token) values ($1, 'item-b', $2)`, [B, SEALED]);
  await rows(`insert into public.coinbase_links (user_id, sealed_tokens, expires_at) values ($1, $2, now())`, [B, SEALED]);
}, 60_000);

describe("sign-up", () => {
  it("creates an empty profile, never copying a name out of sign-up metadata", async () => {
    expect(await rows(`select user_id, first_name from public.profiles order by user_id`)).toEqual([
      { user_id: A, first_name: null },
      { user_id: B, first_name: null },
    ]);
  });
});

describe("a signed-in person", () => {
  it("sees only their own rows", async () => {
    await as("authenticated", A, async () => {
      expect(await rows(`select user_id from public.profiles`)).toEqual([{ user_id: A }]);
      expect(await rows(`select * from public.plaid_items`)).toEqual([]);
      expect(await rows(`select * from public.coinbase_links`)).toEqual([]);
    });
  });

  it("cannot write into someone else's account, or change their plan", async () => {
    await as("authenticated", A, async () => {
      expect(await refused(`insert into public.plaid_items (user_id, item_id, sealed_token) values ($1, 'steal', $2)`, [B, SEALED])).toBe(true);
      await rows(`update public.profiles set plan_budgets = '[{"category":"food","limit":1}]'::jsonb where user_id = $1`, [B]);
    });
    expect((await rows(`select plan_budgets from public.profiles where user_id = $1`, [B]))[0]!.plan_budgets).toBeNull();
  });

  it("can keep their own bank, re-link it, and stay within the table's own limits", async () => {
    await as("authenticated", A, async () => {
      await rows(`insert into public.plaid_items (user_id, item_id, sealed_token) values ($1, 'item-a', $2)`, [A, SEALED]);
      expect(await rows(`select item_id from public.plaid_items`)).toEqual([{ item_id: "item-a" }]);
      // The upsert a re-link performs: same bank, new sealed token.
      await rows(
        `insert into public.plaid_items (user_id, item_id, sealed_token) values ($1, 'item-a', $2)
         on conflict (user_id, item_id) do update set sealed_token = excluded.sealed_token`,
        [A, "n".repeat(40)],
      );
      expect(await rows(`select sealed_token from public.plaid_items`)).toEqual([{ sealed_token: "n".repeat(40) }]);
      // …but an upsert can't hijack someone else's row.
      expect(
        await refused(
          `insert into public.plaid_items (user_id, item_id, sealed_token) values ($1, 'item-b', $2)
           on conflict (user_id, item_id) do update set sealed_token = excluded.sealed_token`,
          [B, SEALED],
        ),
      ).toBe(true);
      expect(await refused(`update public.profiles set plan_goals = '[1,2,3,4,5,6,7,8,9]'::jsonb where user_id = $1`, [A])).toBe(true);
      expect(await refused(`insert into public.calendar_feeds (user_id, token_hash, sealed_token) values ($1, 'not-a-hash', $2)`, [A, SEALED])).toBe(true);
    });
  });

  it("can't land a Coinbase refresh against a version someone else already moved past", async () => {
    await as("authenticated", B, async () => {
      const first = await rows(`update public.coinbase_links set version = version + 1 where user_id = $1 and version = 1 returning version`, [B]);
      const second = await rows(`update public.coinbase_links set version = version + 1 where user_id = $1 and version = 1 returning version`, [B]);
      expect(first).toEqual([{ version: 2 }]);
      expect(second).toEqual([]);
    });
  });
});

describe("anyone signed out", () => {
  it("can't read a single table", async () => {
    await as("anon", null, async () => {
      for (const t of ["profiles", "plaid_items", "coinbase_links", "calendar_feeds"]) expect(await refused(`select * from public.${t}`)).toBe(true);
      expect(await refused(`select public.delete_my_account()`)).toBe(true);
      expect(await refused(`select public.handle_new_user()`)).toBe(true);
      expect(await refused(`select public.touch_updated_at()`)).toBe(true);
    });
  });

  it("gets a calendar snapshot only with the exact secret", async () => {
    const token = "t".repeat(43);
    const hash = createHash("sha256").update(token).digest("hex");
    await rows(`insert into public.calendar_feeds (user_id, token_hash, sealed_token, snapshot) values ($1, $2, $3, '{"v":1,"streams":[],"accounts":[]}'::jsonb)`, [A, hash, SEALED]);
    await as("anon", null, async () => {
      expect((await rows(`select public.calendar_feed_snapshot($1) as s`, [hash]))[0]!.s).toEqual({ v: 1, streams: [], accounts: [] });
      expect((await rows(`select public.calendar_feed_snapshot($1) as s`, ["0".repeat(64)]))[0]!.s).toBeNull();
      expect((await rows(`select public.calendar_feed_snapshot($1) as s`, ["' or 1=1 --"]))[0]!.s).toBeNull();
    });
    // Signed-in people read their own feed through its table; the lookup is for calendar apps only.
    await as("authenticated", B, async () => {
      expect(await refused(`select public.calendar_feed_snapshot($1)`, [hash])).toBe(true);
    });
  });
});

describe("delete my account", () => {
  it("removes the person and every row of theirs, and nobody else's", async () => {
    await as("authenticated", A, () => rows(`select public.delete_my_account()`));
    for (const t of ["profiles", "plaid_items", "calendar_feeds"]) {
      expect((await rows(`select count(*)::int as n from public.${t} where user_id = $1`, [A]))[0]!.n).toBe(0);
    }
    expect((await rows(`select count(*)::int as n from auth.users where id = $1`, [A]))[0]!.n).toBe(0);
    expect((await rows(`select count(*)::int as n from public.plaid_items where user_id = $1`, [B]))[0]!.n).toBe(1);
  });
});
