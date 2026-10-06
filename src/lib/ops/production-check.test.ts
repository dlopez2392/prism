// The production check (production-check.ts) against a site that answers as
// production does, and against each way it can go wrong: every failure is
// named, says what it found, and says what to do.

import { describe, expect, it } from "vitest";
import { report, runChecks, type Check } from "./production-check";

const BASE = "https://prism.example";
const NOW = new Date("2026-10-02T14:00:00Z");

type Reply = { status: number; headers?: Record<string, string>; body?: unknown };

const healthy: Record<string, Reply> = {
  "GET /": {
    status: 200,
    headers: { "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'", "x-content-type-options": "nosniff", "strict-transport-security": "max-age=63072000" },
  },
  "GET /privacy": { status: 200 },
  "GET /terms": { status: 200 },
  "GET /sign-in": { status: 200 },
  "GET /year": { status: 200 },
  "GET /taxes": { status: 200 },
  "GET /pricing": { status: 200 },
  "GET /manifest.webmanifest": { status: 200, body: { name: "Prism" } },
  "GET /sw.js": { status: 200, headers: { "cache-control": "no-cache, no-store, must-revalidate", "content-security-policy": "default-src 'self'; script-src 'self'" } },
  "GET /api/cron/alerts": { status: 401 },
  "GET /account/export/everything.zip": { status: 303, headers: { location: `${BASE}/sign-in?next=/account` } },
  "GET /.well-known/oauth-protected-resource/mcp": { status: 200, body: { resource: `${BASE}/mcp` } },
  "POST /mcp": { status: 401, headers: { "www-authenticate": 'Bearer error="invalid_token"' } },
  "GET /api/health": { status: 200, body: { ok: true, commit: "61ce917", database: "ok", jobs: { alerts: { last_run: "2026-10-02T13:00:41Z", ok: true } } } },
};

function site(over: Record<string, Reply | null> = {}) {
  const replies = { ...healthy, ...over };
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${new URL(String(url)).pathname}`;
    const r = replies[key];
    if (r === null) throw new Error("connection refused");
    if (!r) return new Response("not found", { status: 404 });
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status, headers: r.headers });
  };
}

const run = (over: Record<string, Reply | null> = {}, extra: { commit?: string; certDays?: number | null } = {}) =>
  runChecks(BASE, { fetchImpl: site(over) as typeof fetch, now: NOW, commit: extra.commit, certDaysLeft: async () => (extra.certDays === undefined ? 80 : extra.certDays) });

const failing = (checks: Check[]) => checks.filter((c) => !c.ok).map((c) => c.name);

describe("the production check", () => {
  it("passes a site that answers as production does", async () => {
    const checks = await run({}, { commit: "61ce9173d1110b50bd53b40787e0058c8b3a8467" });
    expect(failing(checks)).toEqual([]);
    expect(checks.map((c) => c.name)).toEqual([
      "Home page, with its protections",
      "Page /privacy",
      "Page /terms",
      "Page /sign-in",
      "Page /year",
      "Page /taxes",
      "Page /pricing",
      "Installable app",
      "Alert job locked to its secret",
      "Payments webhook locked to its signature",
      "Downloads need sign-in",
      "AI connector asks for sign-in",
      "Database answers",
      "Live release is the one just deployed",
      "Alert job ran",
      "Certificate",
    ]);
  });

  it("fails a home page that lost a protective header, or a page that's down", async () => {
    expect(failing(await run({ "GET /": { status: 200, headers: { "x-content-type-options": "nosniff" } } }))).toEqual(["Home page, with its protections"]);
    expect(failing(await run({ "GET /year": { status: 500 }, "GET /terms": null }))).toEqual(["Page /terms", "Page /year"]);
  });

  it("passes a payments webhook that's off or refuses an unsigned event, and treats one that takes it as serious", async () => {
    expect(failing(await run({ "POST /api/stripe/webhook": { status: 401 } }))).toEqual([]);
    const open = await run({ "POST /api/stripe/webhook": { status: 200 } });
    expect(failing(open)).toEqual(["Payments webhook locked to its signature"]);
    expect(open.find((c) => c.name === "Payments webhook locked to its signature")).toMatchObject({ sensitive: true, fix: expect.stringMatching(/roll back/) });
  });

  it("treats an open door as serious: a job anyone can run, or a download without sign-in", async () => {
    const open = await run({ "GET /api/cron/alerts": { status: 200 }, "GET /account/export/everything.zip": { status: 200 } });
    expect(failing(open)).toEqual(["Alert job locked to its secret", "Downloads need sign-in"]);
    expect(open.find((c) => c.name === "Downloads need sign-in")!.fix).toMatch(/roll back/);
  });

  it("says when the alert job isn't configured at all", async () => {
    const [c] = (await run({ "GET /api/cron/alerts": { status: 404 } })).filter((x) => !x.ok);
    expect(c!.fix).toMatch(/CRON_SECRET or RESEND_API_KEY/);
  });

  it("fails a notification worker a browser would cache", async () => {
    expect(failing(await run({ "GET /sw.js": { status: 200, headers: { "cache-control": "public, max-age=3600" } } }))).toEqual(["Installable app"]);
  });

  it("fails when the database won't answer", async () => {
    const checks = await run({ "GET /api/health": { status: 503, body: { ok: false, commit: "61ce917", database: "unreachable", jobs: {} } } });
    expect(failing(checks)).toEqual(["Database answers"]);
    expect(checks.find((c) => c.name === "Database answers")!.detail).toBe("database unreachable");
  });

  it("fails when the domain still serves an older release than the one deployed", async () => {
    const checks = await run({}, { commit: "aaaaaaa1111111" });
    expect(failing(checks)).toEqual(["Live release is the one just deployed"]);
  });

  it("fails a morning without the alert job, or a run that didn't finish, but not a job that hasn't run yet", async () => {
    const health = (jobs: unknown) => ({ "GET /api/health": { status: 200, body: { ok: true, commit: "61ce917", database: "ok", jobs } } });
    const stale = await run(health({ alerts: { last_run: "2026-10-01T10:00:00Z", ok: true } }));
    expect(failing(stale)).toEqual(["Alert job ran"]);
    expect(stale.find((c) => c.name === "Alert job ran")!.detail).toBe("last ran 28 hours ago");
    const stopped = await run(health({ alerts: { last_run: "2026-10-02T13:00:41Z", ok: false } }));
    expect(stopped.find((c) => c.name === "Alert job ran")!.fix).toMatch(/Resend refused/);
    expect(failing(await run(health({})))).toEqual([]);
  });

  it("fails a certificate about to expire, or one it can't read", async () => {
    expect(failing(await run({}, { certDays: 9 }))).toEqual(["Certificate"]);
    expect(failing(await run({}, { certDays: null }))).toEqual(["Certificate"]);
  });
});

describe("the report", () => {
  it("leads with how many fail, lists every check with its words, and says what to do", async () => {
    const checks = await run({ "GET /api/cron/alerts": { status: 404 } });
    const text = report(checks, { base: BASE, commit: "61ce9173d1", at: NOW });
    expect(text).toMatch(/^## Production check: 1 of 15 failing/);
    expect(text).toContain("release 61ce917");
    expect(text).toContain("| ❌ Fail | Alert job locked to its secret | answered 404 |");
    expect(text).toMatch(/### What to do\n\n- \*\*Alert job locked to its secret:\*\* The job isn't configured/);
    expect(report(await run(), { base: BASE, at: NOW })).toMatch(/^## Production check: all 15 passing/);
  });
});

describe("in public", () => {
  it("never says which door is open, or what it found, only that one is and what to do first", async () => {
    const checks = await run({ "GET /account/export/everything.zip": { status: 200 }, "GET /year": { status: 500 } });
    const text = report(checks, { base: BASE, at: NOW, publicly: true });
    expect(text).not.toMatch(/Downloads need sign-in|everything\.zip|answered 200/);
    expect(text).toContain("| ❌ Fail | A protective check | withheld: this repository is public |");
    expect(text).toMatch(/Roll back the latest deploy/);
    // What isn't a door is still said plainly.
    expect(text).toContain("| ❌ Fail | Page /year | answered 500 |");
    // From a private terminal, everything.
    expect(report(checks, { base: BASE, at: NOW })).toContain("Downloads need sign-in");
  });

  it("doesn't treat a job that isn't configured, or a site that's down, as an open door", async () => {
    const checks = await run({ "GET /api/cron/alerts": { status: 404 }, "GET /": null });
    expect(checks.filter((c) => c.sensitive)).toEqual([]);
  });
});
