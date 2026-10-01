// One run of the job (job.ts): who is due comes from the database, each
// snapshot is opened with the vault key, news is sent and then recorded, a
// quiet person gets nothing, a key Resend refuses stops the run, and the
// deadline leaves the rest for tomorrow.

import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AlertSnapshot } from "@/lib/finance/alert-snapshot";
import { sealPacked } from "@/lib/server/vault";

vi.mock("server-only", () => ({}));
const { runAlertJob } = await import("./job");
const { fingerprint } = await import("./plan");
const { alertsConfig } = await import("./send");

const config = alertsConfig({ RESEND_API_KEY: "re_test", CRON_SECRET: "s".repeat(44) })!;
const key = randomBytes(32);
const U = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
const TUESDAY = new Date("2026-10-06T13:00:00Z");

const snap: AlertSnapshot = {
  v: 1,
  at: "2026-10-05T18:00:00.000Z",
  today: "2026-10-05",
  alerts: [
    {
      id: "price-rise:s1:1599",
      kind: "price-rise",
      title: "StreamCo went up to $15.99",
      detail: "It was $12.99.",
      quiet: { title: "StreamCo raised its price", detail: "Its latest charge was higher." },
      on: "2026-10-01",
      href: "/cash-flow",
      urgent: false,
    },
  ],
  weekly: { from: "2026-09-28", to: "2026-10-04", spent: 1, spentBefore: 1, month: null, netWorth: 1, netWorthLastMonth: null },
  upcoming: null,
};

const row = (over: Record<string, unknown> = {}) => ({
  user_id: U,
  email: "a@x.test",
  time_zone: "America/Chicago",
  kinds: ["bank", "bill-short", "price-rise", "weekly"],
  amounts: true,
  sealed: sealPacked(snap, key),
  snapshot_at: snap.at,
  banks: [],
  sent: [],
  ...over,
});

function fakeDb(due: unknown[], { failRecord = false } = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  return {
    calls,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      if (fn === "alerts_due") return { data: due, error: null };
      return { data: null, error: failRecord ? { message: "no" } : null };
    },
  };
}

const resend = (status = 200) => vi.fn(async () => new Response("{}", { status }));

describe("the alert email job", () => {
  it("sends what's new to each person, then records it by fingerprint, all with the secret", async () => {
    const db = fakeDb([row(), row({ user_id: V, email: "b@x.test", kinds: ["bank"] })]);
    const fetchImpl = resend();
    const report = await runAlertJob(db, config, key, { now: TUESDAY, fetchImpl });
    expect(report).toEqual({ due: 2, sent: 1, quiet: 1, failed: 0, refused: 0, unopened: 0, later: 0, stopped: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).to).toEqual(["a@x.test"]);
    expect(db.calls).toEqual([
      ["alerts_due", { p_secret: config.secret }],
      ["alerts_sent", { p_secret: config.secret, p_user_id: U, p_fingerprints: [fingerprint(U, "price-rise:s1:1599")] }],
    ]);
  });

  it("records nothing that didn't go, so it's tried again tomorrow", async () => {
    const db = fakeDb([row()]);
    expect(await runAlertJob(db, config, key, { now: TUESDAY, fetchImpl: resend(500) })).toMatchObject({ sent: 0, failed: 1 });
    expect(db.calls.map(([fn]) => fn)).toEqual(["alerts_due"]);
  });

  it("stops at once when Resend refuses the key itself, leaving everyone else for tomorrow", async () => {
    const db = fakeDb([row(), row({ user_id: V })]);
    const fetchImpl = resend(403);
    expect(await runAlertJob(db, config, key, { now: TUESDAY, fetchImpl })).toMatchObject({ stopped: true, later: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops starting emails at its deadline", async () => {
    const db = fakeDb([row(), row({ user_id: V })]);
    const fetchImpl = resend();
    expect(await runAlertJob(db, config, key, { now: TUESDAY, fetchImpl, deadline: Date.now() - 1 })).toMatchObject({ sent: 0, later: 2 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats a snapshot it can't open as none: bank warnings still go, figures don't", async () => {
    const banks = [{ id: "item-1", name: "First Bank", attention: "sign-in", since: "2026-10-05T09:00:00Z", disconnect_at: null }];
    const db = fakeDb([row({ sealed: sealPacked(snap, randomBytes(32)), banks })]);
    const fetchImpl = resend();
    expect(await runAlertJob(db, config, key, { now: TUESDAY, fetchImpl })).toMatchObject({ sent: 1, unopened: 1 });
    expect(db.calls[1]![1].p_fingerprints).toEqual([fingerprint(U, "bank:item-1:sign-in:2026-10-05")]);
  });

  it("ignores anything in a row that isn't what the database promises", async () => {
    const db = fakeDb([row({ kinds: ["price-rise", "everything"], banks: [{ id: "x", name: "X", attention: "drop tables" }, null], sent: [42] })]);
    expect(await runAlertJob(db, config, key, { now: TUESDAY, fetchImpl: resend() })).toMatchObject({ sent: 1 });
    expect(db.calls[1]![1].p_fingerprints).toHaveLength(1);
  });

  it("fails loudly when the database won't say who is due", async () => {
    const db = { rpc: async () => ({ data: null, error: { message: "not allowed" } }) };
    await expect(runAlertJob(db, config, key, { now: TUESDAY, fetchImpl: resend() })).rejects.toThrow(/didn't say who is due/);
  });
});
