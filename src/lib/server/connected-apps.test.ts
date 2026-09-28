import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentData } from "@/lib/agent/tools";

vi.mock("server-only", () => ({}));
const agentFinance = vi.fn<(account: { userId: string }) => Promise<AgentData>>();
vi.mock("./finance", () => ({ agentFinance: (a: { userId: string }) => agentFinance(a) }));

const { agentDataFor, connectedAppVerifier } = await import("./connected-apps");

const ENV = { url: "https://ref.supabase.co", key: "sb_publishable_test" };
const b64 = (x: unknown) => Buffer.from(JSON.stringify(x)).toString("base64url");
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: "ES256", typ: "JWT" })}.${b64(claims)}.c2ln`;
const EXP = Math.floor(Date.now() / 1000) + 3600;
const APP_TOKEN = jwt({ sub: "u1", role: "authenticated", client_id: "client-1", exp: EXP, scope: "email" });
const SESSION_TOKEN = jwt({ sub: "u1", role: "authenticated", session_id: "s1", exp: EXP });

/** Supabase Auth's GET /user: vouches for live tokens, refuses the rest. */
function authServer(live: Set<string>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const auth = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get("authorization") ?? "";
    expect(url).toBe("https://ref.supabase.co/auth/v1/user");
    return live.has(auth.replace(/^Bearer /, ""))
      ? Response.json({ id: "u1", aud: "authenticated", role: "authenticated", email: "a@x.test", app_metadata: {}, user_metadata: {}, created_at: "2026-09-01T00:00:00Z" })
      : Response.json({ code: 403, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" }, { status: 403 });
  });
}

describe("which tokens the MCP endpoint accepts", () => {
  it("takes a live token issued to a connected app, and knows whose it is", async () => {
    const info = await connectedAppVerifier(ENV, authServer(new Set([APP_TOKEN])) as typeof fetch).verifyAccessToken(APP_TOKEN);
    expect(info).toMatchObject({ clientId: "client-1", expiresAt: EXP, scopes: ["email"], extra: { userId: "u1", email: "a@x.test" } });
  });

  it("refuses a token Supabase no longer stands behind — an app the person disconnected", async () => {
    await expect(connectedAppVerifier(ENV, authServer(new Set()) as typeof fetch).verifyAccessToken(APP_TOKEN)).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("answers an outage with 'try again', not 'bad token' — no pointless trip back through sign-in", async () => {
    const down = vi.fn(async () => new Response("upstream error", { status: 503 }));
    await expect(connectedAppVerifier(ENV, down as typeof fetch).verifyAccessToken(APP_TOKEN)).rejects.toMatchObject({ code: "server_error" });
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(connectedAppVerifier(ENV, offline as typeof fetch).verifyAccessToken(APP_TOKEN)).rejects.toMatchObject({ code: "server_error" });
  });

  it("refuses the person's own browser session: only connected apps come in here", async () => {
    await expect(connectedAppVerifier(ENV, authServer(new Set([SESSION_TOKEN])) as typeof fetch).verifyAccessToken(SESSION_TOKEN)).rejects.toMatchObject({
      code: "invalid_token",
      message: expect.stringMatching(/connected app/),
    });
  });
});

describe("loading a person's money for a conversation", () => {
  const auth = (userId: string) => ({ token: APP_TOKEN, clientId: "client-1", scopes: [], expiresAt: EXP, extra: { userId, email: null } });
  const data = { demo: true } as AgentData;
  beforeEach(() => agentFinance.mockReset());

  it("reuses a load for a minute, per person", async () => {
    agentFinance.mockResolvedValue(data);
    const t = 1_000_000_000_000;
    await agentDataFor(ENV, auth("cache-a"), t);
    await agentDataFor(ENV, auth("cache-a"), t + 30_000);
    await agentDataFor(ENV, auth("cache-b"), t + 30_000);
    expect(agentFinance).toHaveBeenCalledTimes(2);
    await agentDataFor(ENV, auth("cache-a"), t + 61_000);
    expect(agentFinance).toHaveBeenCalledTimes(3);
    expect(agentFinance.mock.calls.map(([a]) => a.userId)).toEqual(["cache-a", "cache-b", "cache-a"]);
  });

  it("never lets an old failure throw away a newer load", async () => {
    let fail!: (e: Error) => void;
    agentFinance.mockReturnValueOnce(new Promise((_, reject) => (fail = reject))).mockResolvedValueOnce(data);
    const t = 3_000_000_000_000;
    const slow = agentDataFor(ENV, auth("race"), t);
    await agentDataFor(ENV, auth("race"), t + 61_000); // the first went stale; a fresh load replaces it
    fail(new Error("late failure"));
    await expect(slow).rejects.toThrow("late failure");
    await agentDataFor(ENV, auth("race"), t + 62_000);
    expect(agentFinance).toHaveBeenCalledTimes(2);
  });

  it("never serves a failed load twice", async () => {
    agentFinance.mockRejectedValueOnce(new Error("bank down")).mockResolvedValueOnce(data);
    const t = 2_000_000_000_000;
    await expect(agentDataFor(ENV, auth("flaky"), t)).rejects.toThrow("bank down");
    await expect(agentDataFor(ENV, auth("flaky"), t + 1_000)).resolves.toBe(data);
  });
});

describe("discovery, as an MCP client meets it", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ENV.url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ENV.key);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("answers a call without a token with a 401 that points at the metadata", async () => {
    const { POST } = await import("@/app/mcp/route");
    const res = await POST(new Request("https://prism.example/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('resource_metadata="https://prism.example/.well-known/oauth-protected-resource/mcp"');
    expect(res.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");
  });

  it("publishes which server signs people in, for exactly this endpoint", async () => {
    const { GET } = await import("@/app/.well-known/oauth-protected-resource/[[...resource]]/route");
    const doc = await GET(new Request("https://prism.example/.well-known/oauth-protected-resource/mcp")).json();
    expect(doc).toMatchObject({
      resource: "https://prism.example/mcp",
      authorization_servers: ["https://ref.supabase.co/auth/v1"],
      bearer_methods_supported: ["header"],
    });
  });
});
