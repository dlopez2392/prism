// The job's two doors as the world meets them: /api/cron/alerts answers only
// Vercel Cron's secret, and only where everything it needs is set;
// /api/alerts/unsubscribe turns off exactly the person its signed link names,
// for a mail app's one-click post and for the confirm button alike.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>(async () => ({ data: [], error: null }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));

const cron = await import("@/app/api/cron/alerts/route");
const unsubscribe = await import("@/app/api/alerts/unsubscribe/route");
const { unsubscribeToken } = await import("./send");

const SECRET = "s".repeat(44);
const U = "11111111-1111-4111-8111-111111111111";

function configure({ vault = true }: { vault?: boolean } = {}) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("CRON_SECRET", SECRET);
  if (vault) vi.stubEnv("PRISM_VAULT_KEY", randomBytes(32).toString("base64"));
}

const runJob = (auth?: string) => cron.GET(new Request("https://prism.example/api/cron/alerts", { headers: auth ? { authorization: auth } : {} }));
const stop = (query: string, body = "List-Unsubscribe=One-Click") =>
  unsubscribe.POST(new Request(`https://prism.example/api/alerts/unsubscribe?${query}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }));

beforeEach(() => {
  rpc.mockClear();
  rpc.mockResolvedValue({ data: [], error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("the daily job's door", () => {
  it("isn't there unless the secret, Resend, the database and the vault key all are", async () => {
    expect((await runJob(`Bearer ${SECRET}`)).status).toBe(404);
    configure({ vault: false });
    expect((await runJob(`Bearer ${SECRET}`)).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is never there on a preview, whatever it was given", async () => {
    configure();
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await runJob(`Bearer ${SECRET}`)).status).toBe(404);
  });

  it("answers Vercel Cron's secret and nothing else", async () => {
    configure();
    expect((await runJob()).status).toBe(401);
    expect((await runJob(`Bearer ${"x".repeat(44)}`)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    const res = await runJob(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ due: 0, sent: 0 });
    expect(rpc).toHaveBeenCalledWith("alerts_due", { p_secret: SECRET });
  });

  it("reports a database that won't answer, with no detail", async () => {
    configure();
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied for function alerts_due" } });
    const res = await runJob(`Bearer ${SECRET}`);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/permission/);
  });
});

describe("one-click unsubscribe", () => {
  const signed = `u=${U}&t=${unsubscribeToken(U, SECRET)}`;

  it("turns off exactly the person the signed link names", async () => {
    configure();
    const res = await stop(signed);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("alerts_stop", { p_secret: SECRET, p_user_id: U });
  });

  it("does nothing for a link that isn't signed for that person", async () => {
    configure();
    const other = "22222222-2222-4222-8222-222222222222";
    expect((await stop(`u=${other}&t=${unsubscribeToken(U, SECRET)}`)).status).toBe(400);
    expect((await stop(`u=${U}`)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the confirm button back to the page, with how it went", async () => {
    configure();
    let res = await stop(signed, "from=page");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://prism.bis-rgv.com/alerts/unsubscribe?done=1");
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    res = await stop(signed, "from=page");
    expect(res.headers.get("location")).toBe("https://prism.bis-rgv.com/alerts/unsubscribe?failed=1");
    res = await stop(`u=${U}&t=nope`, "from=page");
    expect(res.headers.get("location")).toBe("https://prism.bis-rgv.com/alerts/unsubscribe?invalid=1");
  });

  it("isn't there where alert emails aren't, and refuses an oversized body", async () => {
    expect((await stop(signed)).status).toBe(404);
    configure();
    expect((await stop(signed, "x".repeat(5000))).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });
});
