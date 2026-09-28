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
const C = "33333333-3333-3333-3333-333333333333";
const SEALED = "x".repeat(40);
let db: PGlite;

const rows = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows;
const refused = async (sql: string, params: unknown[] = []) => rows(sql, params).then(() => false, () => true);

/** Run as a role, the way PostgREST would for a token with these claims. `extra` adds claims — a connected app's `client_id`, say. */
async function as<T>(role: "anon" | "authenticated", sub: string | null, fn: () => Promise<T>, extra: Record<string, unknown> = {}): Promise<T> {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub ?? ""]);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role, ...(sub ? { sub } : {}), ...extra })]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}

/** A token Supabase's OAuth server issued to a connected app (Claude, ChatGPT…) on the person's behalf. */
const CONNECTED_APP = { client_id: "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d" };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text, phone text, encrypted_password text default '', raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant execute on function auth.jwt() to anon, authenticated;
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

describe("a connected app, holding a token issued on the person's behalf", () => {
  it("reads what the person can read", async () => {
    await as(
      "authenticated",
      B,
      async () => {
        expect(await rows(`select user_id from public.profiles`)).toEqual([{ user_id: B }]);
        expect(await rows(`select item_id from public.plaid_items`)).toEqual([{ item_id: "item-b" }]);
        expect((await rows(`select count(*)::int as n from public.coinbase_links`))[0]!.n).toBe(1);
      },
      CONNECTED_APP,
    );
  });

  it("can change, add or remove nothing, in any table", async () => {
    const before = await rows(`select plan_budgets, time_zone from public.profiles where user_id = $1`, [B]);
    const version = (await rows(`select version from public.coinbase_links where user_id = $1`, [B]))[0]!.version;
    await as(
      "authenticated",
      B,
      async () => {
        // Refused outright…
        expect(await refused(`insert into public.plaid_items (user_id, item_id, sealed_token) values ($1, 'item-new', $2)`, [B, SEALED])).toBe(true);
        expect(await refused(`insert into public.calendar_feeds (user_id, token_hash, sealed_token) values ($1, $2, $3)`, [B, "a".repeat(64), SEALED])).toBe(true);
        expect(await refused(`insert into public.profiles (user_id) values ($1) on conflict (user_id) do update set plan_goals = '[]'::jsonb`, [B])).toBe(true);
        expect(await refused(`select public.delete_my_account()`)).toBe(true);
        // …or matching no rows at all.
        expect(await rows(`update public.profiles set plan_budgets = '[{"category":"food","limit":1}]'::jsonb, time_zone = 'Asia/Tokyo' where user_id = $1 returning user_id`, [B])).toEqual([]);
        expect(await rows(`update public.coinbase_links set version = version + 1 where user_id = $1 returning version`, [B])).toEqual([]);
        expect(await rows(`delete from public.plaid_items where user_id = $1 returning item_id`, [B])).toEqual([]);
        expect(await rows(`delete from public.coinbase_links where user_id = $1 returning user_id`, [B])).toEqual([]);
      },
      CONNECTED_APP,
    );
    expect(await rows(`select plan_budgets, time_zone from public.profiles where user_id = $1`, [B])).toEqual(before);
    expect((await rows(`select version from public.coinbase_links where user_id = $1`, [B]))[0]!.version).toBe(version);
    expect((await rows(`select count(*)::int as n from public.plaid_items where user_id = $1`, [B]))[0]!.n).toBe(1);
    expect((await rows(`select count(*)::int as n from auth.users where id = $1`, [B]))[0]!.n).toBe(1);
  });

  it("while the person's own session still writes as before", async () => {
    await as("authenticated", B, async () => {
      expect(await rows(`update public.profiles set time_zone = 'America/Chicago' where user_id = $1 returning time_zone`, [B])).toEqual([{ time_zone: "America/Chicago" }]);
      // A time zone is a name, never free text.
      expect(await refused(`update public.profiles set time_zone = 'x''; drop table x; --' where user_id = $1`, [B])).toBe(true);
    });
  });
});

describe("a bank's stored sync", () => {
  const packed = "z1." + "s".repeat(60);

  it("is saved only over the version it started from, so an older copy never wins", async () => {
    await as("authenticated", B, async () => {
      const first = await rows(`update public.plaid_items set sealed_sync = $2, sync_version = sync_version + 1, synced_at = now() where user_id = $1 and item_id = 'item-b' and sync_version = 0 returning sync_version`, [B, packed]);
      const late = await rows(`update public.plaid_items set sealed_sync = $2, sync_version = sync_version + 1, synced_at = now() where user_id = $1 and item_id = 'item-b' and sync_version = 0 returning sync_version`, [B, "old".padEnd(40, "x")]);
      expect(first).toEqual([{ sync_version: 1 }]);
      expect(late).toEqual([]);
    });
    expect((await rows(`select sealed_sync from public.plaid_items where item_id = 'item-b'`))[0]!.sealed_sync).toBe(packed);
  });

  it("can't be written by a connected app", async () => {
    await as(
      "authenticated",
      B,
      async () => {
        expect(await rows(`update public.plaid_items set sealed_sync = null where user_id = $1 returning item_id`, [B])).toEqual([]);
      },
      CONNECTED_APP,
    );
    expect((await rows(`select sealed_sync from public.plaid_items where item_id = 'item-b'`))[0]!.sealed_sync).toBe(packed);
  });

  it("is flagged by Plaid's webhook — which can stamp 'news' on that bank and do nothing else", async () => {
    await as("anon", null, async () => {
      expect(await refused(`select public.plaid_item_changed('item-b')`)).toBe(false);
      expect(await refused(`select public.plaid_item_changed('no-such-item')`)).toBe(false);
      expect(await refused(`select public.plaid_item_changed($1)`, ["' or 1=1 --"])).toBe(false);
      // Still can't read a thing.
      expect(await refused(`select * from public.plaid_items`)).toBe(true);
    });
    // Only the bank it named, and only that one column.
    const after = await rows(`select item_id, changed_at is not null as flagged, sealed_sync from public.plaid_items order by item_id`);
    expect(after).toEqual([
      { item_id: "item-a", flagged: false, sealed_sync: null },
      { item_id: "item-b", flagged: true, sealed_sync: packed },
    ]);
    // Signed-in people (and connected apps) have no use for it.
    await as("authenticated", B, async () => {
      expect(await refused(`select public.plaid_item_changed('item-b')`)).toBe(true);
    });
  });
});

describe("what an account signs in with", () => {
  it("its password can never be set or changed — Prism signs in by email code only", async () => {
    // Supabase gives a code-created account a random password at sign-up (an insert); after that it is frozen.
    await rows(`insert into auth.users (id, email, encrypted_password) values ($1, 'c@x.test', '$2a$10$random-at-sign-up')`, [C]);
    expect(await refused(`update auth.users set encrypted_password = '$2a$10$chosen-by-a-connector' where id = $1`, [C])).toBe(true);
    expect((await rows(`select encrypted_password from auth.users where id = $1`, [C]))[0]!.encrypted_password).toBe("$2a$10$random-at-sign-up");
    // Everything else about the account still updates, and clearing a password is allowed.
    expect(await rows(`update auth.users set raw_user_meta_data = '{}'::jsonb, encrypted_password = encrypted_password, email = email where id = $1 returning id`, [C])).toEqual([{ id: C }]);
    expect(await refused(`update auth.users set encrypted_password = '' where id = $1`, [C])).toBe(false);
  });

  it("nor can its email address or phone — whoever holds those holds the account", async () => {
    expect(await refused(`update auth.users set email = 'someone-else@x.test' where id = $1`, [C])).toBe(true);
    expect(await refused(`update auth.users set phone = '15555550100' where id = $1`, [C])).toBe(true);
    expect((await rows(`select email, phone from auth.users where id = $1`, [C]))[0]).toEqual({ email: "c@x.test", phone: null });
    await rows(`delete from auth.users where id = $1`, [C]);
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
