// /api/health (health.ts): which release is live, whether the database
// answers, and when each job last ran — nothing about anyone, a 503 when the
// database won't answer, and one database call per 30 seconds at most.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn<(fn: string) => { abortSignal: () => Promise<{ data: unknown; error: unknown }> }>();
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));

const { forgetHealth, health } = await import("./health");
const { GET } = await import("@/app/api/health/route");

const answers = (result: { data: unknown; error: unknown } | Error) =>
  rpc.mockImplementation(() => ({ abortSignal: async () => (result instanceof Error ? Promise.reject(result) : result) }));

describe("the health check", () => {
  beforeEach(() => {
    forgetHealth();
    rpc.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "61ce9173d1110b50bd53b40787e0058c8b3a8467");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("says which release is live, that the database answers, and when each job last ran", async () => {
    answers({ data: [{ name: "alerts", ran_at: "2026-10-02T13:00:41+00:00", ok: true }], error: null });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, commit: "61ce917", database: "ok", jobs: { alerts: { last_run: "2026-10-02T13:00:41+00:00", ok: true } } });
    expect(rpc).toHaveBeenCalledWith("job_health");
  });

  it("is a 503 when the database won't answer, or doesn't in time, and says nothing more", async () => {
    answers({ data: null, error: { message: "permission denied" } });
    const res = await GET();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/permission/);
    forgetHealth();
    answers(new Error("The operation was aborted due to timeout"));
    expect(await health()).toMatchObject({ ok: false, database: "unreachable" });
  });

  it("asks the database at most once every 30 seconds", async () => {
    answers({ data: [], error: null });
    const t = Date.now();
    await health(t);
    await health(t + 10_000);
    await health(t + 29_000);
    expect(rpc).toHaveBeenCalledTimes(1);
    await health(t + 31_000);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("names no release it can't vouch for, and works with no database at all", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "not a sha; <script>");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(await health()).toEqual({ ok: true, commit: null, database: "not_configured", jobs: {} });
    expect(rpc).not.toHaveBeenCalled();
  });
});
