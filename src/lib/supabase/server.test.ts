import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const claims = vi.fn<() => Record<string, unknown>>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [{ name: "prism-auth", value: "x" }], set: () => undefined }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: { claims: claims() }, error: null }) } }),
}));

describe("who is signed in to Prism itself", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  });

  it("is the person whose own session the cookie holds", async () => {
    claims.mockReturnValue({ sub: "u1", email: "a@x.test", session_id: "s1" });
    const { currentAccount } = await import("./server");
    expect(await currentAccount()).toMatchObject({ userId: "u1", email: "a@x.test" });
  });

  it("is nobody when the cookie carries a connected app's token", async () => {
    // A connector token is a genuine Supabase JWT for the person, so its
    // signature checks out; dressed up as a Prism cookie it must still open
    // nothing — not the bank unlink, not Delete account, not a Coinbase refresh.
    claims.mockReturnValue({ sub: "u1", email: "a@x.test", client_id: "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d" });
    const { currentAccount } = await import("./server");
    expect(await currentAccount()).toBeNull();
  });
});
