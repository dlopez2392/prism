// The account schema, proven as each role would meet it. Every migration is
// applied to an in-memory Postgres (PGlite) with stand-ins for the pieces of
// Supabase it relies on — the auth.users table, auth.uid(), and the anon and
// authenticated roles with Supabase's default grants — so a policy mistake
// fails here, in CI, before it can reach the real database.

import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { keyId, sealJson, sealPacked, vaultKey } from "@/lib/server/vault";

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
    -- Supabase Auth's own records of a person's authenticators and of each session's assurance level.
    create table auth.mfa_factors (id uuid primary key, user_id uuid not null references auth.users (id) on delete cascade, factor_type text not null default 'totp', status text not null);
    create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users (id) on delete cascade, aal text not null default 'aal1', factor_id uuid);
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

describe("two-step sign-in", () => {
  const D = "44444444-4444-4444-4444-444444444444";
  const F1 = "f1f1f1f1-0000-4000-8000-000000000001"; // D's authenticator
  const F2 = "f2f2f2f2-0000-4000-8000-000000000002"; // a second one on D's account
  const S_EMAIL = "5e550000-0000-4000-8000-000000000001"; // email code only
  const S_PASSED = "5e550000-0000-4000-8000-000000000002"; // passed F1
  const S_OTHER = "5e550000-0000-4000-8000-000000000003"; // passed F2
  const S_HALF = "5e550000-0000-4000-8000-000000000004"; // names F1, but Supabase has it at aal1
  const session = (id: string, aal: "aal1" | "aal2") => ({ session_id: id, aal });
  const seesOwnBank = async (claims: Record<string, unknown>) => (await as("authenticated", D, () => rows(`select item_id from public.plaid_items`), claims)).length === 1;

  beforeAll(async () => {
    await rows(`insert into auth.users (id, email) values ($1, 'd@x.test')`, [D]);
    await rows(`insert into public.plaid_items (user_id, item_id, sealed_token) values ($1, 'item-d', $2)`, [D, SEALED]);
    await rows(`insert into auth.mfa_factors (id, user_id, status) values ($1, $3, 'verified'), ($2, $3, 'verified')`, [F1, F2, D]);
    await rows(
      `insert into auth.sessions (id, user_id, aal, factor_id) values ($1, $4, 'aal1', null), ($2, $4, 'aal2', $5), ($3, $4, 'aal2', $6), ($7, $4, 'aal1', $5)`,
      [S_EMAIL, S_PASSED, S_OTHER, D, F1, F2, S_HALF],
    );
  });

  it("changes nothing for someone who hasn't turned it on", async () => {
    expect(await seesOwnBank(session(S_EMAIL, "aal1"))).toBe(true);
    expect(await as("authenticated", D, () => rows(`select public.second_step_pending() as p`), session(S_EMAIL, "aal1"))).toEqual([{ p: false }]);
  });

  it("can be registered only by a session that has just passed that very authenticator", async () => {
    const register = (claims: Record<string, unknown>, factor: string) =>
      as("authenticated", D, () => rows(`update public.profiles set totp_factor_id = $1 where user_id = $2`, [factor, D]), claims);
    // The email code alone, a session that passed a different authenticator, a token that only claims aal2: all refused.
    expect(await register(session(S_EMAIL, "aal1"), F1).then(() => false, () => true)).toBe(true);
    expect(await register(session(S_OTHER, "aal2"), F1).then(() => false, () => true)).toBe(true);
    expect(await register(session(S_EMAIL, "aal2"), F1).then(() => false, () => true)).toBe(true);
    // Someone else's authenticator can't be registered either.
    await rows(`insert into auth.mfa_factors (id, user_id, status) values ('f3f3f3f3-0000-4000-8000-000000000003', $1, 'verified')`, [B]);
    expect(await register(session(S_PASSED, "aal2"), "f3f3f3f3-0000-4000-8000-000000000003").then(() => false, () => true)).toBe(true);
    expect((await rows(`select totp_factor_id from public.profiles where user_id = $1`, [D]))[0]!.totp_factor_id).toBeNull();
    // The session that passed F1 can.
    await register(session(S_PASSED, "aal2"), F1);
    expect((await rows(`select totp_factor_id from public.profiles where user_id = $1`, [D]))[0]!.totp_factor_id).toBe(F1);
  });

  it("then closes every row to a session that has only the email code", async () => {
    const emailOnly = session(S_EMAIL, "aal1");
    await as(
      "authenticated",
      D,
      async () => {
        expect((await rows(`select public.second_step_pending() as p`))[0]!.p).toBe(true);
        for (const t of ["profiles", "plaid_items", "coinbase_links", "calendar_feeds"]) expect(await rows(`select * from public.${t}`)).toEqual([]);
        expect(await refused(`insert into public.plaid_items (user_id, item_id, sealed_token) values ($1, 'sneak', $2)`, [D, SEALED])).toBe(true);
        await rows(`update public.profiles set totp_factor_id = null where user_id = $1`, [D]);
        await rows(`delete from public.plaid_items where user_id = $1`, [D]);
        expect(await refused(`select public.delete_my_account()`)).toBe(true);
        // What it may learn is which authenticator to ask for.
        expect((await rows(`select public.my_second_step_factor() as f`))[0]!.f).toBe(F1);
      },
      emailOnly,
    );
    // None of that landed.
    expect((await rows(`select totp_factor_id from public.profiles where user_id = $1`, [D]))[0]!.totp_factor_id).toBe(F1);
    expect((await rows(`select count(*)::int as n from public.plaid_items where user_id = $1`, [D]))[0]!.n).toBe(1);
    expect((await rows(`select count(*)::int as n from auth.users where id = $1`, [D]))[0]!.n).toBe(1);
  });

  it("opens them only to a session that passed the registered authenticator, by the token AND by Supabase's own record", async () => {
    expect(await seesOwnBank(session(S_PASSED, "aal2"))).toBe(true);
    // A different authenticator on the same account doesn't count.
    expect(await seesOwnBank(session(S_OTHER, "aal2"))).toBe(false);
    // A token claiming aal2 for a session Supabase has at aal1 doesn't count; nor an aal1 token for a passed session.
    expect(await seesOwnBank(session(S_EMAIL, "aal2"))).toBe(false);
    expect(await seesOwnBank(session(S_PASSED, "aal1"))).toBe(false);
    // A session Supabase still has at aal1 doesn't count, whatever factor it names and whatever the token claims.
    expect(await seesOwnBank(session(S_HALF, "aal2"))).toBe(false);
    // Nor a token without a session at all.
    expect(await seesOwnBank({ aal: "aal2" })).toBe(false);
  });

  it("leaves connected apps readable (and still read-only), since they were approved behind the second step", async () => {
    const app = { ...CONNECTED_APP, ...session(S_EMAIL, "aal1") };
    expect(await seesOwnBank(app)).toBe(true);
    await as("authenticated", D, () => rows(`delete from public.plaid_items where user_id = $1`, [D]), app);
    expect((await rows(`select count(*)::int as n from public.plaid_items where user_id = $1`, [D]))[0]!.n).toBe(1);
  });

  it("is off again once the registered authenticator is removed, and a passed session can turn it off", async () => {
    await rows(`update auth.mfa_factors set status = 'unverified' where id = $1`, [F1]);
    expect(await seesOwnBank(session(S_EMAIL, "aal1"))).toBe(true);
    await rows(`update auth.mfa_factors set status = 'verified' where id = $1`, [F1]);
    expect(await seesOwnBank(session(S_EMAIL, "aal1"))).toBe(false);
    await as("authenticated", D, () => rows(`update public.profiles set totp_factor_id = null where user_id = $1`, [D]), session(S_PASSED, "aal2"));
    expect(await seesOwnBank(session(S_EMAIL, "aal1"))).toBe(true);
  });

  it("keeps its checks out of reach of anyone signed out", async () => {
    await as("anon", null, async () => {
      expect(await refused(`select public.second_step_pending()`)).toBe(true);
      expect(await refused(`select public.my_second_step_factor()`)).toBe(true);
      expect(await refused(`select public.check_totp_registration()`)).toBe(true);
    });
  });
});

describe("the vault key census (README, \"Replacing the vault key\")", () => {
  /** The SQL exactly as the README prints it, so the owner's copy can't drift from the schema. */
  const census = async () => {
    const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
    const sql = /```sql\n([\s\S]*?)```/.exec(readme.slice(readme.indexOf("## Replacing the vault key")))![1]!;
    const counts = new Map<string, number>();
    for (const r of await rows(sql)) counts.set(`${r.what} ${r.key_id}`, Number(r.count));
    return counts;
  };

  it("counts every sealed column by the key that sealed it, reading key ids only", async () => {
    const D = "c0ffee00-0000-4000-8000-00000000ca5e";
    const [oldKey, newKey, other] = [randomBytes(32), randomBytes(32), randomBytes(32)];
    const [o, n] = [keyId(oldKey), keyId(newKey)];
    // Seals name their key only while a rotation is under way, so each of these rings holds two keys.
    const ring = (current: Buffer) => vaultKey({ PRISM_VAULT_KEY: other.toString("base64"), PRISM_VAULT_KEY_2: current.toString("base64") })!;
    const before = await census();
    await rows(`insert into auth.users (id, email) values ($1, 'd@x.test')`, [D]);
    await rows(`insert into public.plaid_items (user_id, item_id, sealed_token, sealed_sync) values ($1, 'moved', $2, $3), ($1, 'waiting', $4, null)`, [
      D,
      sealJson({ accessToken: "a" }, ring(newKey)),
      sealPacked({ cursor: "c" }, ring(newKey)),
      SEALED,
    ]);
    await rows(`insert into public.coinbase_links (user_id, sealed_tokens, expires_at) values ($1, $2, now())`, [D, sealJson({ accessToken: "a" }, ring(oldKey))]);
    await rows(`insert into public.calendar_feeds (user_id, token_hash, sealed_token, snapshot) values ($1, $2, $3, $4)`, [
      D,
      "d".repeat(64),
      sealJson({ token: "t" }, ring(newKey)),
      JSON.stringify({ v: 2, sealed: sealJson({ bills: [] }, ring(newKey)) }),
    ]);
    await rows(`update public.profiles set sealed_category_rules = $2, sealed_manual_items = $3 where user_id = $1`, [
      D,
      sealPacked({ v: 1, merchants: {}, transactions: {} }, ring(oldKey)),
      sealPacked([], ring(newKey)),
    ]);
    const after = await census();
    const delta = (what: string, id: string) => (after.get(`${what} ${id}`) ?? 0) - (before.get(`${what} ${id}`) ?? 0);
    expect([
      delta("bank token", n),
      delta("bank token", "unnamed"),
      delta("bank transactions", n),
      delta("coinbase", o),
      delta("calendar link", n),
      delta("calendar bills", n),
      delta("category fixes", o),
      delta("added by hand", n),
    ]).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    for (const id of after.keys()) expect(id).toMatch(/ ([A-Za-z0-9_-]{8}|unnamed)$/);
    await rows(`delete from auth.users where id = $1`, [D]);
  });
});

describe.each(["sealed_category_rules", "sealed_manual_items"])("a person's %s", (column) => {
  const E = "e0e0e0e0-0000-4000-8000-00000000f1c5";
  const fixes = "z1." + "c".repeat(40);

  it("is theirs alone to keep and clear, as ciphertext, and a connected app can read it but never change it", async () => {
    await rows(`insert into auth.users (id, email) values ($1, 'e@x.test')`, [E]);
    await as("authenticated", E, async () => {
      expect(await rows(`update public.profiles set ${column} = $2 where user_id = $1 returning user_id`, [E, fixes])).toEqual([{ user_id: E }]);
      // Only ever a sealed value: nothing short enough to be a shop's or a house's name in the clear.
      expect(await refused(`update public.profiles set ${column} = 'Trader Joe''s' where user_id = $1`, [E])).toBe(true);
    });
    await as("authenticated", A, async () => {
      expect(await rows(`select ${column} from public.profiles where user_id = $1`, [E])).toEqual([]);
      expect(await rows(`update public.profiles set ${column} = null where user_id = $1 returning user_id`, [E])).toEqual([]);
    });
    await as(
      "authenticated",
      E,
      async () => {
        expect(await rows(`select ${column} from public.profiles where user_id = $1`, [E])).toEqual([{ [column]: fixes }]);
        expect(await rows(`update public.profiles set ${column} = null where user_id = $1 returning user_id`, [E])).toEqual([]);
      },
      CONNECTED_APP,
    );
    await as("authenticated", E, async () => {
      expect(await rows(`update public.profiles set ${column} = null where user_id = $1 returning ${column}`, [E])).toEqual([{ [column]: null }]);
    });
    await rows(`delete from auth.users where id = $1`, [E]);
  });
});

describe("a household", () => {
  const person = (n: number) => `4a000000-0000-4000-8000-00000000000${n}`;
  const [H1, H2, H3, H4, H5, X] = [person(1), person(2), person(3), person(4), person(5), person(9)];
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  const [LINK2, LINK3, LINK4, LINK5] = [hash("link-2"), hash("link-3"), hash("link-4"), hash("link-5")];
  const call = (who: string, sql: string, params: unknown[] = [], claims: Record<string, unknown> = {}) => as("authenticated", who, () => rows(sql, params), claims);
  const fails = (who: string, sql: string, params: unknown[] = [], claims: Record<string, unknown> = {}) => as("authenticated", who, () => refused(sql, params), claims);
  const errcode = (who: string, sql: string, params: unknown[] = []) => as("authenticated", who, () => rows(sql, params).then(() => null, (e: { code?: string }) => e.code ?? "?"));
  const shares = async (who: string) => (await rows(`select account_id from public.shared_accounts where user_id = $1 order by account_id`, [who])).map((r) => r.account_id);

  beforeAll(async () => {
    for (const [id, n] of [[H1, 1], [H2, 2], [H3, 3], [H4, 4], [H5, 5], [X, 9]] as const) {
      await rows(`insert into auth.users (id, email) values ($1, $2)`, [id, `H${n}@X.test`]);
      await rows(`update public.profiles set first_name = $2 where user_id = $1`, [id, `Person${n}`]);
    }
    // H2 banks at two places, and will share one account from the first only.
    await rows(`insert into public.plaid_items (user_id, item_id, sealed_token, institution_name, sealed_sync) values ($1, 'joint', $2, 'Joint Bank', $3), ($1, 'secret', $2, 'Secret Bank', $3)`, [H2, SEALED, "z1." + "s".repeat(40)]);
    await rows(`update public.profiles set sealed_manual_items = $2, sealed_category_rules = $2 where user_id = $1`, [H2, "z1." + "m".repeat(40)]);
  });

  it("starts with an invitation only its own email can use, once", async () => {
    // Shares left over from before (written past the policies here) never go live in a new household.
    await rows(`insert into public.shared_accounts (user_id, account_id) values ($1, 'manual-old'), ($2, 'manual-old')`, [H1, H2]);
    // Emails match whatever their case: sign-up stored "H2@X.test".
    await call(H1, `select public.create_household_invite('  H2@x.TEST ', $1)`, [LINK2]);
    expect(await shares(H1)).toEqual([]);
    expect(await call(H1, `select email from public.household_invites`)).toEqual([{ email: "h2@x.test" }]);
    expect(await call(H1, `select count(*)::int as n from public.household_members`)).toEqual([{ n: 1 }]);
    // Anyone else holding the link learns nothing, and can't use it.
    expect(await call(X, `select * from public.household_invite_status($1)`, [LINK2])).toEqual([{ status: "wrong_email", invited_by_name: null }]);
    expect(await fails(X, `select public.accept_household_invite($1)`, [LINK2])).toBe(true);
    expect(await call(X, `select * from public.household_invites`)).toEqual([]);
    // The person it names sees who sent it, and joins.
    expect(await call(H2, `select * from public.household_invite_status($1)`, [LINK2])).toEqual([{ status: "ok", invited_by_name: "Person1" }]);
    await call(H2, `select public.accept_household_invite($1)`, [LINK2]);
    expect(await call(H2, `select first_name, is_me from public.household_people()`)).toEqual([
      { first_name: "Person1", is_me: false },
      { first_name: "Person2", is_me: true },
    ]);
    expect(await shares(H2)).toEqual([]);
    // Once.
    expect(await fails(H2, `select public.accept_household_invite($1)`, [LINK2])).toBe(true);
    expect(await call(H2, `select * from public.household_invite_status($1)`, [LINK2])).toEqual([{ status: "not_found", invited_by_name: null }]);
    // Nobody invites themselves, or someone already in.
    expect(await errcode(H1, `select public.create_household_invite('h1@x.test', $1)`, [hash("self")])).toBe("22023");
    expect(await errcode(H1, `select public.create_household_invite('h2@x.test', $1)`, [hash("again")])).toBe("23505");
    expect(await call(H1, `select count(*)::int as n from public.household_invites`)).toEqual([{ n: 0 }]);
  });

  it("has room for four people, counting invitations still open", async () => {
    await call(H1, `select public.create_household_invite('h3@x.test', $1)`, [LINK3]);
    await call(H2, `select public.create_household_invite('h4@x.test', $1)`, [LINK4]);
    expect(await errcode(H1, `select public.create_household_invite('h5@x.test', $1)`, [LINK5])).toBe("23514");
    // Any member can cancel an open invitation; then there's room again.
    expect(await call(H1, `delete from public.household_invites where email = 'h4@x.test' returning email`)).toEqual([{ email: "h4@x.test" }]);
    await call(H1, `select public.create_household_invite('h5@x.test', $1)`, [LINK5]);
    // And joining checks again, should two people ever take the last seats at once (written past the functions here).
    const household = (await rows(`select household_id from public.household_members where user_id = $1`, [H1]))[0]!.household_id;
    const Y = person(8);
    await rows(`insert into auth.users (id, email) values ($1, 'h8@x.test')`, [Y]);
    await rows(`insert into public.household_members (household_id, user_id) values ($1, $2), ($1, $3)`, [household, X, Y]);
    expect(await call(H5, `select * from public.household_invite_status($1)`, [LINK5])).toEqual([{ status: "full", invited_by_name: null }]);
    expect(await errcode(H5, `select public.accept_household_invite($1)`, [LINK5])).toBe("23514");
    await rows(`delete from auth.users where id = $1`, [Y]);
    await rows(`delete from public.household_members where user_id = $1`, [X]);
    expect(await call(H5, `select status from public.household_invite_status($1)`, [LINK5])).toEqual([{ status: "ok" }]);
    // Someone already in a household can't join another.
    await call(H4, `select public.create_household_invite('h3@x.test', $1)`, [hash("h4-invites-h3")]);
    await call(H3, `select public.accept_household_invite($1)`, [hash("h4-invites-h3")]);
    expect(await call(H3, `select * from public.household_invite_status($1)`, [LINK3])).toEqual([{ status: "in_another", invited_by_name: null }]);
    expect(await fails(H3, `select public.accept_household_invite($1)`, [LINK3])).toBe(true);
  });

  it("can't be written to except through its own steps", async () => {
    // Even knowing the household's id, nobody writes themselves in.
    const household = (await rows(`select household_id from public.household_members where user_id = $1`, [H1]))[0]!.household_id;
    expect(await fails(X, `insert into public.household_members (household_id, user_id) values ($1, $2)`, [household, X])).toBe(true);
    expect(await call(H1, `delete from public.household_members where user_id = $1 returning user_id`, [H2])).toEqual([]);
    expect(await call(H1, `update public.household_members set user_id = $1 returning user_id`, [X])).toEqual([]);
    expect(await fails(H1, `insert into public.household_invites (household_id, invited_by, email, token_hash) select household_id, $1, 'x@x.test', $2 from public.household_members limit 1`, [H1, hash("direct")])).toBe(true);
    expect(await fails(H1, `insert into public.shared_accounts (user_id, account_id, item_id) values ($1, 'acc-9', 'joint')`, [H2])).toBe(true);
    // Outside a household there is no one to share with.
    expect(await fails(X, `insert into public.shared_accounts (user_id, account_id) values ($1, 'manual-car')`, [X])).toBe(true);
    expect(await call(X, `select * from public.households`)).toEqual([]);
    expect(await call(X, `select * from public.household_shared_money()`)).toEqual([]);
  });

  it("shows another member exactly what they shared, sealed, and never a token or a bank they share nothing from", async () => {
    expect(await call(H1, `select * from public.household_shared_money()`)).toEqual([]);
    // A bank account needs its connection; something added by hand has none.
    expect(await fails(H2, `insert into public.shared_accounts (user_id, account_id, item_id) values ($1, 'manual-car', 'joint')`, [H2])).toBe(true);
    expect(await fails(H2, `insert into public.shared_accounts (user_id, account_id) values ($1, 'acc-joint')`, [H2])).toBe(true);
    await call(H2, `insert into public.shared_accounts (user_id, account_id, item_id) values ($1, 'acc-joint', 'joint')`, [H2]);
    const [money] = await call(H1, `select * from public.household_shared_money()`);
    expect(money).toMatchObject({ user_id: H2, first_name: "Person2", shared_account_ids: ["acc-joint"], sealed_manual_items: null });
    expect(money!.sealed_category_rules).toMatch(/^z1\./);
    const items = money!.items as Record<string, unknown>[];
    expect(items.map((i) => i.institution_name)).toEqual(["Joint Bank"]);
    expect(Object.keys(items[0]!).sort()).toEqual(["institution_name", "item_id", "sealed_sync", "synced_at"]);
    expect(JSON.stringify(money)).not.toContain("Secret Bank");
    await call(H2, `insert into public.shared_accounts (user_id, account_id) values ($1, 'manual-car')`, [H2]);
    expect((await call(H1, `select sealed_manual_items from public.household_shared_money()`))[0]!.sealed_manual_items).toMatch(/^z1\./);
    // Each sees the others' shares, never their own over again.
    await call(H1, `insert into public.shared_accounts (user_id, account_id) values ($1, 'manual-bike')`, [H1]);
    expect((await call(H1, `select user_id from public.household_shared_money()`)).map((r) => r.user_id)).toEqual([H2]);
    expect((await call(H2, `select user_id from public.household_shared_money()`)).map((r) => r.user_id)).toEqual([H1]);
    // The owner's own rows are still theirs alone.
    expect(await call(H1, `select item_id from public.plaid_items where user_id = $1`, [H2])).toEqual([]);
    expect(await call(H1, `select user_id from public.profiles where user_id = $1`, [H2])).toEqual([]);
    // Someone outside the household gets nothing.
    expect(await call(H3, `select * from public.household_shared_money()`)).toEqual([]);
  });

  it("is closed to connected apps, which read and never write", async () => {
    expect(await fails(H1, `select * from public.household_shared_money()`, [], CONNECTED_APP)).toBe(true);
    expect(await fails(H1, `select public.create_household_invite('x@x.test', $1)`, [hash("app")], CONNECTED_APP)).toBe(true);
    expect(await fails(H2, `insert into public.shared_accounts (user_id, account_id) values ($1, 'manual-boat')`, [H2], CONNECTED_APP)).toBe(true);
    expect(await call(H2, `delete from public.shared_accounts where user_id = $1 returning account_id`, [H2], CONNECTED_APP)).toEqual([]);
    expect(await fails(H2, `select public.leave_household()`, [], CONNECTED_APP)).toBe(true);
  });

  it("is closed to a session that hasn't passed the member's own second step", async () => {
    const [F, PASSED, EMAIL_ONLY] = ["4f000000-0000-4000-8000-000000000001", "4f000000-0000-4000-8000-000000000002", "4f000000-0000-4000-8000-000000000003"];
    await rows(`insert into auth.mfa_factors (id, user_id, status) values ($1, $2, 'verified')`, [F, H1]);
    await rows(`insert into auth.sessions (id, user_id, aal, factor_id) values ($1, $3, 'aal2', $4), ($2, $3, 'aal1', null)`, [PASSED, EMAIL_ONLY, H1, F]);
    await call(H1, `update public.profiles set totp_factor_id = $2 where user_id = $1`, [H1, F], { session_id: PASSED, aal: "aal2" });
    const emailOnly = { session_id: EMAIL_ONLY, aal: "aal1" };
    expect(await fails(H1, `select * from public.household_shared_money()`, [], emailOnly)).toBe(true);
    expect(await fails(H1, `select * from public.household_people()`, [], emailOnly)).toBe(true);
    expect(await call(H1, `select * from public.household_members`, [], emailOnly)).toEqual([]);
    expect((await call(H1, `select * from public.household_shared_money()`, [], { session_id: PASSED, aal: "aal2" })).length).toBe(1);
    await rows(`update public.profiles set totp_factor_id = null where user_id = $1`, [H1]);
  });

  it("stops sharing at once when someone leaves, and ends with its last member", async () => {
    await call(H2, `select public.leave_household()`);
    expect(await rows(`select count(*)::int as n from public.shared_accounts where user_id = $1`, [H2])).toEqual([{ n: 0 }]);
    expect(await call(H1, `select * from public.household_shared_money()`)).toEqual([]);
    const household = (await rows(`select household_id from public.household_members where user_id = $1`, [H1]))[0]!.household_id;
    await call(H1, `select public.leave_household()`);
    expect(await rows(`select count(*)::int as n from public.households where id = $1`, [household])).toEqual([{ n: 0 }]);
    expect(await rows(`select count(*)::int as n from public.household_invites where household_id = $1`, [household])).toEqual([{ n: 0 }]);
  });

  it("goes when its last member deletes their account", async () => {
    const household = (await rows(`select household_id from public.household_members where user_id = $1`, [H4]))[0]!.household_id;
    await call(H3, `select public.delete_my_account()`);
    await call(H4, `select public.delete_my_account()`);
    expect(await rows(`select count(*)::int as n from public.households where id = $1`, [household])).toEqual([{ n: 0 }]);
  });
});
