// The change notice's email (notice-job.ts): off until NOTICE_EMAIL names a
// notice, never on a preview, never on or after the change's day; each
// account in its language, recorded once it went, a key Resend refuses
// stops the run, and the deadline leaves the rest for tomorrow.

import { describe, expect, it, vi } from "vitest";
import { noticeById } from "@/lib/legal-notice";

vi.mock("server-only", () => ({}));
const { noticeToSend, renderNoticeEmail, runNoticeJob } = await import("./notice-job");
const { alertsConfig } = await import("./send");
const { translator } = await import("@/lib/i18n/translator");

const config = alertsConfig({ RESEND_API_KEY: "re_test", CRON_SECRET: "s".repeat(44) })!;
const plus = noticeById("plus-2026-11")!;
const BEFORE = new Date("2026-10-24T13:00:00Z");
const U = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";

function db(due: unknown[]) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return fn === "notice_due" ? { data: due, error: null } : { data: null, error: null };
    }),
  };
}

const resend = (status: number) => vi.fn<typeof fetch>(async () => new Response("{}", { status }));

describe("whether it goes", () => {
  it("only once the operator names a notice Prism has, and never on a preview", () => {
    expect(noticeToSend({})).toBeNull();
    expect(noticeToSend({ NOTICE_EMAIL: "plus-2026-11" })?.id).toBe("plus-2026-11");
    expect(noticeToSend({ NOTICE_EMAIL: "something-else" })).toBeNull();
    expect(noticeToSend({ NOTICE_EMAIL: "plus-2026-11", VERCEL_ENV: "preview" })).toBeNull();
  });

  it("never on or after the change's day: a notice after the change isn't one", async () => {
    const d = db([{ user_id: U, email: "u@x.test", language: "en" }]);
    const fetchImpl = resend(200);
    expect(await runNoticeJob(d, config, plus, { now: new Date("2026-11-23T13:00:00Z"), fetchImpl })).toEqual({ notice: "plus-2026-11", skipped: "late" });
    expect(d.rpc).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("a run", () => {
  it("writes to each account in its language, with no unsubscribe header, and records each that went", async () => {
    const d = db([
      { user_id: U, email: "u@x.test", language: "en" },
      { user_id: V, email: "v@x.test", language: "es" },
    ]);
    const fetchImpl = resend(200);
    const report = await runNoticeJob(d, config, plus, { now: BEFORE, fetchImpl });
    expect(report).toEqual({ notice: "plus-2026-11", due: 2, sent: 2, refused: 0, failed: 0, later: 0, stopped: false });
    const bodies = fetchImpl.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(bodies[0]).toMatchObject({ to: ["u@x.test"], subject: "Prism Plus starts on November 23, 2026" });
    expect(bodies[1]).toMatchObject({ to: ["v@x.test"], subject: "Prism Plus empieza el 23 de noviembre de 2026" });
    expect(bodies[0].headers).toBeUndefined();
    expect(d.calls.filter((c) => c.fn === "notice_sent").map((c) => c.args.p_user_id)).toEqual([U, V]);
    expect(d.calls[0]).toEqual({ fn: "notice_due", args: { p_secret: config.secret, p_notice: "plus-2026-11" } });
  });

  it("records an address Resend refuses, leaves a failure for tomorrow, and stops on a refused key", async () => {
    const d = db([
      { user_id: U, email: "bad", language: "en" },
      { user_id: V, email: "v@x.test", language: "en" },
    ]);
    const report = await runNoticeJob(d, config, plus, { now: BEFORE, fetchImpl: resend(422) });
    expect(report).toMatchObject({ refused: 2, sent: 0 });
    expect(d.calls.filter((c) => c.fn === "notice_sent")).toHaveLength(2);

    const failing = db([{ user_id: U, email: "u@x.test", language: "en" }]);
    expect(await runNoticeJob(failing, config, plus, { now: BEFORE, fetchImpl: resend(500) })).toMatchObject({ failed: 1 });
    expect(failing.calls.filter((c) => c.fn === "notice_sent")).toHaveLength(0);

    const stopped = db([
      { user_id: U, email: "u@x.test", language: "en" },
      { user_id: V, email: "v@x.test", language: "en" },
    ]);
    expect(await runNoticeJob(stopped, config, plus, { now: BEFORE, fetchImpl: resend(401) })).toMatchObject({ stopped: true, later: 2, sent: 0 });
  });

  it("leaves whoever is past the deadline for tomorrow", async () => {
    const d = db([{ user_id: U, email: "u@x.test", language: "en" }]);
    const fetchImpl = resend(200);
    expect(await runNoticeJob(d, config, plus, { now: BEFORE, deadline: Date.now() - 1, fetchImpl })).toMatchObject({ due: 1, sent: 0, later: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws when the database won't say who is due", async () => {
    const broken = { rpc: vi.fn(async () => ({ data: null, error: { message: "x" } })) };
    await expect(runNoticeJob(broken, config, plus, { now: BEFORE, fetchImpl: resend(200) })).rejects.toThrow();
  });
});

describe("the email", () => {
  it("says every change in plain words, links straight to Prism, and escapes nothing it shouldn't", () => {
    const m = renderNoticeEmail(plus, "https://prism.bis-rgv.com", translator("en"));
    expect(m.text).toContain("$5.99 a month or $49 a year");
    expect(m.text).toContain("https://prism.bis-rgv.com/terms");
    expect(m.html).toContain('<html lang="en">');
    expect(m.html).not.toMatch(/<img|unsubscribe/i);
    const es = renderNoticeEmail(plus, "https://prism.bis-rgv.com", translator("es"));
    expect(es.html).toContain('<html lang="es">');
    expect(es.text).toContain("23 de noviembre de 2026");
  });
});
