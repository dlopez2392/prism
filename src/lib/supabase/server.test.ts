import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const claims = vi.fn<() => Record<string, unknown>>();
/** What the database says about the second step: owed, not owed, or an error. */
const pending = vi.fn<() => { data: unknown; error: unknown }>(() => ({ data: false, error: null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [{ name: "prism-auth", value: "x" }], set: () => undefined }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getClaims: async () => ({ data: { claims: claims() }, error: null }) },
    rpc: async (name: string) => (name === "second_step_pending" ? pending() : { data: null, error: { message: "unknown" } }),
  }),
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

  it("is nobody while the second step is owed, but is someone awaiting it", async () => {
    claims.mockReturnValue({ sub: "u1", email: "a@x.test", session_id: "s1", aal: "aal1" });
    pending.mockReturnValue({ data: true, error: null });
    const { awaitingSecondStep, currentAccount } = await import("./server");
    expect(await currentAccount()).toBeNull();
    expect(await awaitingSecondStep()).toMatchObject({ userId: "u1" });
  });

  it("counts an unanswerable check as owed, rather than letting an account that can't read its rows pass for an empty one", async () => {
    claims.mockReturnValue({ sub: "u1", email: "a@x.test", session_id: "s1" });
    pending.mockReturnValue({ data: null, error: { message: "network" } });
    const { awaitingSecondStep, currentAccount } = await import("./server");
    expect(await currentAccount()).toBeNull();
    expect(await awaitingSecondStep()).toMatchObject({ userId: "u1" });
  });

  it("is someone, and not awaiting anything, once the step is done or was never on", async () => {
    claims.mockReturnValue({ sub: "u1", email: "a@x.test", session_id: "s1", aal: "aal2" });
    pending.mockReturnValue({ data: false, error: null });
    const { awaitingSecondStep, currentAccount } = await import("./server");
    expect(await currentAccount()).toMatchObject({ userId: "u1" });
    expect(await awaitingSecondStep()).toBeNull();
  });
});

describe("where to finish signing in", () => {
  it("carries on to the page sign-in interrupted", async () => {
    const { twoStepPath } = await import("./server");
    expect(twoStepPath(null)).toBe("/sign-in/two-step");
    expect(twoStepPath("/oauth/consent?authorization_id=a b")).toBe("/sign-in/two-step?next=%2Foauth%2Fconsent%3Fauthorization_id%3Da%20b");
  });
});
