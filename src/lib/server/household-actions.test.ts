// The household actions (household-actions.ts): only for a signed-in person,
// only through the database's own household functions, never the database's
// own words back to the browser, and an invitation's secret only in its link.

import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("./finance", () => ({ VIEW_COOKIE: "prism-view" }));
vi.mock("./origin", () => ({ requestOrigin: async () => "https://prism.bis-rgv.com" }));
const jar = { set: vi.fn(), delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => jar }));
const signedIn = { current: null as unknown };
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => signedIn.current }));

const actions = await import("./household-actions");
const { cancelHouseholdInvite, checkHouseholdInvite, declineHousehold, inviteToHousehold, joinHousehold, leaveTheHousehold, setAccountShared, setHouseholdView } = actions;

type Result = { data: unknown; error: { code?: string; message: string } | null };
type Op = { table: string; op: "select" | "delete" | "upsert"; filters: [string, unknown][]; values?: unknown; options?: unknown };

/** A signed-in person whose database answers each rpc as `rpc` says and each table read as `read` says. */
function person({ rpc = {}, read = () => ({ data: [], error: null }), write = { data: null, error: null } }: { rpc?: Record<string, Result>; read?: (op: Op) => Result; write?: Result } = {}) {
  const calls: { fn: string; args: unknown }[] = [];
  const ops: Op[] = [];
  const table = (name: string) => {
    const op: Op = { table: name, op: "select", filters: [] };
    const b = {
      select: () => b,
      eq: (col: string, val: unknown) => (op.filters.push([col, val]), b),
      limit: () => b,
      delete: () => ((op.op = "delete"), b),
      upsert: (values: unknown, options: unknown) => ((op.op = "upsert"), (op.values = values), (op.options = options), b),
      then: (ok: (r: Result) => unknown, bad: (e: unknown) => unknown) => (ops.push(op), Promise.resolve(op.op === "select" ? read(op) : write).then(ok, bad)),
    };
    return b;
  };
  const supabase = {
    rpc: async (fn: string, args?: unknown) => (calls.push({ fn, args }), rpc[fn] ?? { data: null, error: null }),
    from: table,
  };
  signedIn.current = { userId: "u1", email: "dana@example.com", supabase };
  return { calls, ops };
}
const form = (email: string) => {
  const f = new FormData();
  f.set("email", email);
  return f;
};
const IDLE = { status: "idle" as const };
const TOKEN = "A".repeat(43);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

afterEach(() => {
  signedIn.current = null;
  jar.set.mockClear();
  jar.delete.mockClear();
});

describe("inviting someone", () => {
  it("needs a signed-in person", async () => {
    expect(await inviteToHousehold(IDLE, form("sam@example.com"))).toMatchObject({ status: "error", message: expect.stringMatching(/Sign in/) });
  });

  it("asks for a real email address, and asks the database nothing until it has one", async () => {
    const { calls } = person();
    for (const bad of ["", "sam", "sam@example", "s am@example.com", `${"s".repeat(65)}@example.com`]) {
      expect(await inviteToHousehold(IDLE, form(bad))).toMatchObject({ status: "error", message: expect.stringMatching(/Enter their email/) });
    }
    expect(calls).toEqual([]);
  });

  it("makes a link whose secret only the link carries, after the #, and stores only its sha256", async () => {
    const { calls } = person();
    const res = await inviteToHousehold(IDLE, form("  Sam@Example.COM "));
    expect(res).toMatchObject({ status: "invited", email: "sam@example.com" });
    if (res.status !== "invited") throw new Error("not invited");
    const [, token] = res.link.match(/^https:\/\/prism\.bis-rgv\.com\/household\/join#([A-Za-z0-9_-]{43})$/)!;
    expect(calls).toEqual([{ fn: "create_household_invite", args: { p_email: "sam@example.com", p_token_hash: sha(token!) } }]);
    expect(JSON.stringify(calls)).not.toContain(token);
    // A second link is a new secret.
    const again = await inviteToHousehold(IDLE, form("sam@example.com"));
    expect(again.status === "invited" && again.link).not.toBe(res.link);
  });

  it("says why it couldn't, in its own words, never the database's", async () => {
    const said = async (code: string) => {
      person({ rpc: { create_household_invite: { data: null, error: { code, message: "raise: secret internals" } } } });
      const res = await inviteToHousehold(IDLE, form("sam@example.com"));
      expect(res.status).toBe("error");
      expect(JSON.stringify(res)).not.toContain("internals");
      return res.status === "error" ? res.message : "";
    };
    expect(await said("23514")).toMatch(/room for four/);
    expect(await said("22023")).toMatch(/your own email/);
    expect(await said("23505")).toMatch(/already in your household/);
    expect(await said("42501")).toMatch(/didn't work/);
  });
});

describe("cancelling an invitation", () => {
  it("cancels by its id, and turns away anything that isn't one", async () => {
    const { ops } = person();
    expect(await cancelHouseholdInvite("1; drop table")).toEqual({ ok: false });
    expect(ops).toEqual([]);
    expect(await cancelHouseholdInvite("0b9f7a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b")).toEqual({ ok: true });
    expect(ops).toEqual([{ table: "household_invites", op: "delete", filters: [["id", "0b9f7a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b"]] }]);
  });

  it("says so when it didn't", async () => {
    person({ write: { data: null, error: { message: "timeout" } } });
    expect(await cancelHouseholdInvite("0b9f7a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b")).toEqual({ ok: false });
    signedIn.current = null;
    expect(await cancelHouseholdInvite("0b9f7a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b")).toEqual({ ok: false });
  });
});

describe("opening an invitation", () => {
  it("asks a signed-out visitor to sign in, and tells them nothing else", async () => {
    expect(await checkHouseholdInvite(TOKEN)).toEqual({ status: "signed_out", invitedBy: null });
  });

  it("calls a malformed link not found without asking the database", async () => {
    const { calls } = person();
    expect(await checkHouseholdInvite("short")).toEqual({ status: "not_found", invitedBy: null });
    expect(await checkHouseholdInvite(`${TOKEN.slice(1)}/`)).toEqual({ status: "not_found", invitedBy: null });
    expect(calls).toEqual([]);
  });

  it("passes on what the database says of it, by the link's sha256", async () => {
    const { calls } = person({ rpc: { household_invite_status: { data: [{ status: "ok", invited_by_name: "Dana" }], error: null } } });
    expect(await checkHouseholdInvite(TOKEN)).toEqual({ status: "ok", invitedBy: "Dana" });
    expect(calls).toEqual([{ fn: "household_invite_status", args: { p_token_hash: sha(TOKEN) } }]);
    person({ rpc: { household_invite_status: { data: null, error: { message: "timeout" } } } });
    expect(await checkHouseholdInvite(TOKEN)).toEqual({ status: "error", invitedBy: null });
  });
});

describe("joining, declining and leaving", () => {
  it("joins with the link's sha256, and says plainly when the link is spent", async () => {
    expect(await joinHousehold(TOKEN)).toMatchObject({ ok: false, message: expect.stringMatching(/Sign in/) });
    const { calls } = person();
    expect(await joinHousehold("not-a-link")).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
    expect(await joinHousehold(TOKEN)).toEqual({ ok: true });
    expect(calls).toEqual([{ fn: "accept_household_invite", args: { p_token_hash: sha(TOKEN) } }]);
    person({ rpc: { accept_household_invite: { data: null, error: { code: "42501", message: "this invitation is for someone else" } } } });
    const res = await joinHousehold(TOKEN);
    expect(res).toMatchObject({ ok: false, message: expect.stringMatching(/Ask for a new link/) });
    expect(JSON.stringify(res)).not.toContain("someone else");
  });

  it("declines only a well-formed link, as the person it names", async () => {
    const { calls } = person();
    expect(await declineHousehold("x")).toEqual({ ok: false });
    expect(await declineHousehold(TOKEN)).toEqual({ ok: true });
    expect(calls).toEqual([{ fn: "decline_household_invite", args: { p_token_hash: sha(TOKEN) } }]);
  });

  it("leaves, and goes back to their own money; a failed leave changes nothing", async () => {
    person({ rpc: { leave_household: { data: null, error: { message: "timeout" } } } });
    expect(await leaveTheHousehold()).toEqual({ ok: false });
    expect(jar.delete).not.toHaveBeenCalled();
    const { calls } = person();
    expect(await leaveTheHousehold()).toEqual({ ok: true });
    expect(calls).toEqual([{ fn: "leave_household", args: undefined }]);
    expect(jar.delete).toHaveBeenCalledWith("prism-view");
  });
});

describe("sharing an account", () => {
  const theirs = (op: Op): Result => ({ data: op.filters.some(([c, v]) => c === "item_id" && v === "item-mine") ? [{ item_id: "item-mine" }] : [], error: null });

  it("needs a signed-in person, and a sensible account id", async () => {
    expect(await setAccountShared("manual-car", null, true)).toEqual({ ok: false });
    const { ops } = person();
    expect(await setAccountShared("", null, true)).toEqual({ ok: false });
    expect(await setAccountShared("x".repeat(201), "item-mine", true)).toEqual({ ok: false });
    expect(ops).toEqual([]);
  });

  it("shares a bank account only under one of the person's own connections", async () => {
    const { ops } = person({ read: theirs });
    expect(await setAccountShared("acc-1", "item-theirs", true)).toEqual({ ok: false });
    expect(ops.filter((o) => o.op !== "select")).toEqual([]);
    expect(ops[0]).toEqual({ table: "plaid_items", op: "select", filters: [["user_id", "u1"], ["item_id", "item-theirs"]] });
    expect(await setAccountShared("acc-1", "item-mine", true)).toEqual({ ok: true });
    expect(ops.at(-1)).toEqual({ table: "shared_accounts", op: "upsert", filters: [], values: { user_id: "u1", account_id: "acc-1", item_id: "item-mine" }, options: { onConflict: "user_id,account_id" } });
  });

  it("shares something added by hand with no connection, and never lets the two pass for each other", async () => {
    const { ops } = person({ read: theirs });
    expect(await setAccountShared("manual-car", "item-mine", true)).toEqual({ ok: false });
    expect(await setAccountShared("acc-1", null, true)).toEqual({ ok: false });
    expect(ops).toEqual([]);
    expect(await setAccountShared("manual-car", null, true)).toEqual({ ok: true });
    expect(ops).toEqual([{ table: "shared_accounts", op: "upsert", filters: [], values: { user_id: "u1", account_id: "manual-car", item_id: null }, options: { onConflict: "user_id,account_id" } }]);
  });

  it("won't share Coinbase, which loads live with its owner's own access", async () => {
    const { ops } = person({ read: theirs });
    expect(await setAccountShared("coinbase", null, true)).toEqual({ ok: false });
    expect(await setAccountShared("coinbase", "coinbase", true)).toEqual({ ok: false });
    expect(ops.filter((o) => o.op !== "select")).toEqual([]);
  });

  it("stops sharing their own row, and only theirs", async () => {
    const { ops } = person({ read: theirs });
    expect(await setAccountShared("acc-1", "item-mine", false)).toEqual({ ok: true });
    expect(ops.at(-1)).toEqual({ table: "shared_accounts", op: "delete", filters: [["user_id", "u1"], ["account_id", "acc-1"]] });
  });

  it("says so when the write didn't happen", async () => {
    person({ read: theirs, write: { data: null, error: { message: "new row violates row-level security policy" } } });
    expect(await setAccountShared("manual-car", null, true)).toEqual({ ok: false });
  });
});

describe("Me or Household", () => {
  it("remembers Household in an httpOnly cookie, and Me by forgetting it", async () => {
    await setHouseholdView("household");
    expect(jar.set).toHaveBeenCalledWith("prism-view", "household", expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 }));
    await setHouseholdView("me");
    expect(jar.delete).toHaveBeenCalledWith("prism-view");
    jar.set.mockClear();
    await setHouseholdView("anything else" as "me");
    expect(jar.set).not.toHaveBeenCalled();
  });
});
