// The webhook endpoint as Plaid meets it: believed only when signed, and then
// it can do one thing — stamp "news" on the bank it names.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verified = vi.fn<(config: unknown, jwt: string | null, raw: Uint8Array) => Promise<boolean>>();
vi.mock("@/lib/plaid/webhook", async (real) => ({ ...(await real<typeof import("./webhook")>()), verifyPlaidWebhook: (c: unknown, j: string | null, r: Uint8Array) => verified(c, j, r) }));
const rpc = vi.fn(async () => ({ data: null, error: null as { message: string } | null }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));

const { POST } = await import("@/app/api/plaid/webhook/route");

const post = (body: unknown) =>
  POST(new Request("https://prism.example/api/plaid/webhook", { method: "POST", headers: { "plaid-verification": "jwt" }, body: typeof body === "string" ? body : JSON.stringify(body, null, 2) }));

describe("Plaid's webhook", () => {
  beforeEach(() => {
    vi.stubEnv("PLAID_CLIENT_ID", "id");
    vi.stubEnv("PLAID_SECRET", "secret");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    rpc.mockClear();
    rpc.mockResolvedValue({ data: null, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("flags the bank it names when Plaid signed it — checking Plaid's header against the exact bytes sent", async () => {
    verified.mockResolvedValue(true);
    const body = { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-1" };
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("plaid_item_changed", { p_item_id: "item-1" });
    const [, jwt, raw] = verified.mock.calls.at(-1)!;
    expect(jwt).toBe("jwt");
    expect(Buffer.from(raw).toString("utf8")).toBe(JSON.stringify(body, null, 2));
  });

  it("does nothing at all with an unsigned one", async () => {
    verified.mockResolvedValue(false);
    const res = await post({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-1" });
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("acknowledges news that isn't about transactions without flagging anything", async () => {
    verified.mockResolvedValue(true);
    expect((await post({ webhook_type: "HOLDINGS", webhook_code: "DEFAULT_UPDATE", item_id: "item-1" })).status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps a warning about the bank too: a consent ending on a date, a sign-in, a withdrawal", async () => {
    verified.mockResolvedValue(true);
    const res = await post({ webhook_type: "ITEM", webhook_code: "PENDING_DISCONNECT", item_id: "item-1", reason: "INSTITUTION_TOKEN_EXPIRATION", disconnect_time: "2026-10-08T13:25:17.766Z" });
    expect(res.status).toBe(200);
    expect(rpc.mock.calls).toEqual([
      ["plaid_item_changed", { p_item_id: "item-1" }],
      ["plaid_bank_warning", { p_item_id: "item-1", p_event: "disconnecting", p_at: "2026-10-08T13:25:17.766Z" }],
    ]);
    rpc.mockClear();
    await post({ webhook_type: "ITEM", webhook_code: "ERROR", item_id: "item-1", error: { error_code: "ITEM_LOGIN_REQUIRED" } });
    expect(rpc).toHaveBeenLastCalledWith("plaid_bank_warning", { p_item_id: "item-1", p_event: "login-required", p_at: null });
    // An error that isn't a sign-in is news for the next sync, but no warning.
    rpc.mockClear();
    await post({ webhook_type: "ITEM", webhook_code: "ERROR", item_id: "item-1", error: { error_code: "INSTITUTION_DOWN" } });
    expect(rpc.mock.calls.map((call) => (call as unknown[])[0])).toEqual(["plaid_item_changed"]);
    // A warning that couldn't be kept makes Plaid try again.
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: null, error: { message: "db down" } });
    expect((await post({ webhook_type: "ITEM", webhook_code: "LOGIN_REPAIRED", item_id: "item-1" })).status).toBe(500);
  });

  it("asks Plaid to try again when the flag couldn't be recorded", async () => {
    verified.mockResolvedValue(true);
    rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    expect((await post({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-1" })).status).toBe(500);
  });

  it("refuses an oversized body before anything else — by its stated length, and by what actually came", async () => {
    verified.mockResolvedValue(true);
    verified.mockClear();
    expect((await post("x".repeat(70_000))).status).toBe(413);
    const stated = await POST(new Request("https://prism.example/api/plaid/webhook", { method: "POST", headers: { "content-length": "999999" }, body: "{}" }));
    expect(stated.status).toBe(413);
    expect(verified).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
