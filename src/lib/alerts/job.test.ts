// One run of the job (job.ts): who is due comes from the database, each
// snapshot is opened with the vault key, news is sent and then recorded, a
// quiet person gets nothing, a key Resend refuses stops the run, and the
// deadline leaves the rest for tomorrow.

import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AlertSnapshot } from "@/lib/finance/alert-snapshot";
import { sealJson, sealPacked } from "@/lib/server/vault";
import { decryptAsPhone, phoneKeys } from "./test-helpers";
import { vapidKeys } from "./webpush";

vi.mock("server-only", () => ({}));
const morningCheck = vi.fn<(...args: unknown[]) => Promise<AlertSnapshot | null>>(async () => null);
vi.mock("./refresh", () => ({ morningCheck: (...args: unknown[]) => morningCheck(...args) }));
const { runAlertJob, REFRESH_LIMIT_MS } = await import("./job");
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
  by: "visit",
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
  monthly: null,
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

function fakeDb(due: unknown[], { failRecord = false, devices = [] as unknown[] | null } = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  return {
    calls,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      if (fn === "alerts_due") return { data: due, error: null };
      if (fn === "push_due") return devices ? { data: devices, error: null } : { data: null, error: { message: "no" } };
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
    expect(report).toEqual({ due: 2, sent: 1, quiet: 1, failed: 0, refused: 0, unopened: 0, refreshed: 0, unrefreshed: 0, pushed: 0, pushFailed: 0, forgotten: 0, later: 0, stopped: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).to).toEqual(["a@x.test"]);
    expect(db.calls).toEqual([
      ["alerts_due", { p_secret: config.secret }],
      ["alerts_sent", { p_secret: config.secret, p_user_id: U, p_fingerprints: [fingerprint(U, "price-rise:s1:1599")] }],
      ["push_due", { p_secret: config.secret }],
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

  describe("on a phone", () => {
    const phone = phoneKeys();
    const FCM = "https://fcm.googleapis.com/fcm/send/device-1";
    const APPLE = "https://web.push.apple.com/device-2";
    const VAPID = vapidKeys(config.secret).publicKey;
    const device = (id: string, endpoint: string, sealedWith = key, user = U, vapid = VAPID) => ({
      user_id: user,
      id,
      sealed: sealJson({ endpoint, p256dh: phone.p256dh, auth: phone.auth, vapid }, sealedWith),
    });
    /** Resend answers 200; each push service answers as told. */
    const services = (answers: Record<string, number> = {}) =>
      vi.fn(async (url: RequestInfo | URL) => new Response("{}", { status: answers[String(url)] ?? (String(url).includes("resend") ? 200 : 201) }));
    const pushes = (fetchImpl: ReturnType<typeof services>) =>
      (fetchImpl.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => !url.includes("resend"));

    it("sends the email's news to each of the person's devices, encrypted for that device, after the email", async () => {
      const db = fakeDb([row()], { devices: [device("d1", FCM), device("d2", APPLE)] });
      const fetchImpl = services();
      expect(await runAlertJob(db, config, key, { now: TUESDAY, fetchImpl })).toMatchObject({ sent: 1, pushed: 2, pushFailed: 0, forgotten: 0 });
      expect(String(fetchImpl.mock.calls[0]![0])).toMatch(/resend/);
      const sent = pushes(fetchImpl);
      expect(sent.map(([url]) => url).sort()).toEqual([APPLE, FCM].sort());
      for (const [, init] of sent) {
        expect(init.headers).toMatchObject({ "Content-Encoding": "aes128gcm", Authorization: expect.stringMatching(/^vapid t=/) });
        const read = JSON.parse(decryptAsPhone(Buffer.from(init.body as Uint8Array), phone.privateKey, phone.authSecret).toString());
        expect(read).toEqual({ title: "StreamCo went up to $15.99", body: "It was $12.99.", url: "/cash-flow" });
      }
    });

    it("keeps an amount off the phone when the person turned amounts off", async () => {
      const fetchImpl = services();
      await runAlertJob(fakeDb([row({ amounts: false })], { devices: [device("d1", FCM)] }), config, key, { now: TUESDAY, fetchImpl });
      const init = pushes(fetchImpl)[0]![1];
      const read = decryptAsPhone(Buffer.from(init.body as Uint8Array), phone.privateKey, phone.authSecret).toString();
      expect(JSON.parse(read)).toEqual({ title: "StreamCo raised its price", body: "Its latest charge was higher.", url: "/cash-flow" });
    });

    it("forgets a device its push service says is gone, and one no key opens, and only those", async () => {
      const db = fakeDb([row()], { devices: [device("gone", FCM), device("lost", APPLE, randomBytes(32)), device("ok", "https://updates.push.services.mozilla.com/wpush/v2/x")] });
      const fetchImpl = services({ [FCM]: 410 });
      expect(await runAlertJob(db, config, key, { now: TUESDAY, fetchImpl })).toMatchObject({ pushed: 1, forgotten: 2, pushFailed: 0 });
      expect(db.calls.filter(([fn]) => fn === "push_forget").map(([, a]) => a.p_id).sort()).toEqual(["gone", "lost"]);
      expect(db.calls.find(([fn]) => fn === "push_forget")![1]).toMatchObject({ p_secret: config.secret, p_user_id: U });
      // The device no key opens was never sent anything.
      expect(pushes(fetchImpl).map(([url]) => url)).not.toContain(APPLE);
    });

    it("forgets, without sending, a device made for a VAPID key that has since been replaced", async () => {
      const stale = vapidKeys("an-older-secret".padEnd(44, "o")).publicKey;
      const db = fakeDb([row()], { devices: [device("old", FCM, key, U, stale), device("new", APPLE)] });
      const fetchImpl = services();
      expect(await runAlertJob(db, config, key, { now: TUESDAY, fetchImpl })).toMatchObject({ pushed: 1, forgotten: 1 });
      expect(pushes(fetchImpl).map(([url]) => url)).toEqual([APPLE]);
      expect(db.calls.filter(([fn]) => fn === "push_forget").map(([, a]) => a.p_id)).toEqual(["old"]);
    });

    it("counts a push service that fails, keeps the device, and still counts the email as sent", async () => {
      const db = fakeDb([row()], { devices: [device("d1", FCM)] });
      expect(await runAlertJob(db, config, key, { now: TUESDAY, fetchImpl: services({ [FCM]: 503 }) })).toMatchObject({ sent: 1, pushed: 0, pushFailed: 1, forgotten: 0 });
      expect(db.calls.map(([fn]) => fn)).not.toContain("push_forget");
    });

    it("sends nothing to a phone when the email didn't go, and never asks for devices on a quiet morning", async () => {
      const failed = fakeDb([row()], { devices: [device("d1", FCM)] });
      const fetchImpl = services({ "https://api.resend.com/emails": 500 });
      expect(await runAlertJob(failed, config, key, { now: TUESDAY, fetchImpl })).toMatchObject({ failed: 1, pushed: 0 });
      expect(pushes(fetchImpl)).toEqual([]);
      const quiet = fakeDb([row({ kinds: ["bank"] })], { devices: [device("d1", FCM)] });
      await runAlertJob(quiet, config, key, { now: TUESDAY, fetchImpl: services() });
      expect(quiet.calls.map(([fn]) => fn)).toEqual(["alerts_due"]);
    });

    it("asks for the devices once a run, and still emails everyone when the database won't list them", async () => {
      const db = fakeDb([row(), row({ user_id: V, email: "b@x.test" })], { devices: [device("d1", FCM), device("d2", APPLE, key, V)] });
      const fetchImpl = services();
      expect(await runAlertJob(db, config, key, { now: TUESDAY, fetchImpl })).toMatchObject({ sent: 2, pushed: 2 });
      expect(db.calls.filter(([fn]) => fn === "push_due")).toHaveLength(1);
      const refused = fakeDb([row(), row({ user_id: V, email: "b@x.test" })], { devices: null });
      expect(await runAlertJob(refused, config, key, { now: TUESDAY, fetchImpl: services() })).toMatchObject({ sent: 2, pushed: 0 });
    });
  });

  describe("the morning check", () => {
    const morning: AlertSnapshot = { ...snap, by: "morning", at: "2026-10-06T13:00:00.000Z", today: "2026-10-06" };
    const oldSnap = { snapshot_at: "2026-10-04T18:00:00.000Z" };
    afterEach(() => {
      morningCheck.mockReset();
      morningCheck.mockResolvedValue(null);
      vi.useRealTimers();
    });

    it("reads the banks again for someone who allowed it, when their snapshot is old, and emails from what it found", async () => {
      morningCheck.mockResolvedValue(morning);
      const db = fakeDb([row(oldSnap)]);
      const fetchImpl = resend();
      expect(await runAlertJob(db, config, key, { now: TUESDAY, fetchImpl })).toMatchObject({ refreshed: 1, unrefreshed: 0, sent: 1 });
      expect(morningCheck).toHaveBeenCalledWith(db, config, key, U, TUESDAY);
      const html = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).text as string;
      expect(html).toMatch(/check of your banks on Tue, Oct 6/);
    });

    it("leaves the banks alone when the snapshot is recent", async () => {
      await runAlertJob(fakeDb([row({ snapshot_at: "2026-10-06T08:00:00.000Z" })]), config, key, { now: TUESDAY, fetchImpl: resend() });
      expect(morningCheck).not.toHaveBeenCalled();
    });

    it("counts nothing when the database hands nothing over (they didn't allow it), and emails from the last snapshot", async () => {
      morningCheck.mockResolvedValue(null);
      const db = fakeDb([row(oldSnap)]);
      expect(await runAlertJob(db, config, key, { now: TUESDAY, fetchImpl: resend() })).toMatchObject({ refreshed: 0, unrefreshed: 0, sent: 1 });
      expect(morningCheck).toHaveBeenCalledTimes(1);
    });

    it("still emails from the last snapshot when the check fails, and counts it", async () => {
      morningCheck.mockRejectedValue(new Error("down"));
      const db = fakeDb([row(oldSnap)]);
      expect(await runAlertJob(db, config, key, { now: TUESDAY, fetchImpl: resend() })).toMatchObject({ refreshed: 0, unrefreshed: 1, sent: 1 });
    });

    it("stops waiting for a check that runs long, and starts none it can't finish before the deadline", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      morningCheck.mockReturnValue(new Promise(() => undefined));
      const run = runAlertJob(fakeDb([row(oldSnap)]), config, key, { now: TUESDAY, fetchImpl: resend() });
      await vi.advanceTimersByTimeAsync(REFRESH_LIMIT_MS);
      expect(await run).toMatchObject({ refreshed: 0, unrefreshed: 1, sent: 1 });
      vi.useRealTimers();
      morningCheck.mockClear();
      await runAlertJob(fakeDb([row(oldSnap)]), config, key, { now: TUESDAY, fetchImpl: resend(), deadline: Date.now() + REFRESH_LIMIT_MS - 1 });
      expect(morningCheck).not.toHaveBeenCalled();
    });
  });
});
