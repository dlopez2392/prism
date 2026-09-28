// A person's calendar feed holds bills derived from their bank data, so it is
// stored sealed and opened only by the feed route, with the vault key.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn<(name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>>();
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: (n: string, a: unknown) => rpc(n, a) }) }));

const { openFeedSnapshot, sealFeedSnapshot } = await import("./feed-token");
const { saveFeedSnapshot } = await import("./account-store");
const { vaultKey } = await import("./vault");
const { GET } = await import("@/app/calendar/feed/[token]/route");

const snapshot = {
  v: 1,
  builtOn: "2026-09-28",
  streams: [
    {
      id: "s1",
      merchant: "Rent",
      accountId: "a1",
      category: "housing",
      kind: "bill",
      cadence: "monthly",
      amount: -145000,
      variable: false,
      lastDate: "2026-09-01",
      nextDate: "2026-10-01",
      occurrences: 6,
      priceChange: null,
      transactionIds: [],
    },
  ],
  accounts: [{ id: "a1", name: "Checking", mask: "0001", kind: "checking" }],
};

describe("the stored snapshot", () => {
  it("is ciphertext, and opens only with the key that sealed it", () => {
    const key = randomBytes(32);
    const stored = sealFeedSnapshot(snapshot, key);
    expect(stored.v).toBe(2);
    expect(JSON.stringify(stored)).not.toContain("Rent");
    expect(openFeedSnapshot(stored, key)).toEqual(snapshot);
    expect(openFeedSnapshot(stored, randomBytes(32))).toBeNull();
  });

  it("is refused when it isn't sealed at all", () => {
    expect(openFeedSnapshot(snapshot, randomBytes(32))).toBeNull();
    expect(openFeedSnapshot(null, randomBytes(32))).toBeNull();
    expect(openFeedSnapshot({ v: 2, sealed: 42 }, randomBytes(32))).toBeNull();
  });

  it("is what the account store writes — never the bills themselves", async () => {
    const key = randomBytes(32);
    const updates: unknown[] = [];
    const db = { from: () => ({ update: (row: unknown) => (updates.push(row), { eq: async () => ({ error: null }) }) }) };
    await saveFeedSnapshot({ supabase: db as never, userId: "u1", email: "a@x.test" }, snapshot, key);
    const written = (updates[0] as { snapshot: unknown }).snapshot;
    expect(JSON.stringify(written)).not.toContain("Rent");
    expect(openFeedSnapshot(written, key)).toEqual(snapshot);
  });
});

describe("the feed a calendar app fetches", () => {
  const TOKEN = "A".repeat(43);
  const get = () => GET(new Request(`https://prism.example/calendar/feed/${TOKEN}.ics`), { params: Promise.resolve({ token: `${TOKEN}.ics` }) });

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("PRISM_VAULT_KEY", randomBytes(32).toString("base64"));
    rpc.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("serves the bills from a sealed snapshot", async () => {
    rpc.mockResolvedValue({ data: sealFeedSnapshot(snapshot, vaultKey()!), error: null });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Rent");
  });

  it("serves nothing from an unsealed one, or one sealed with another key", async () => {
    rpc.mockResolvedValue({ data: snapshot, error: null });
    expect((await get()).status).toBe(404);
    rpc.mockResolvedValue({ data: sealFeedSnapshot(snapshot, randomBytes(32)), error: null });
    expect((await get()).status).toBe(404);
  });

  it("serves nothing when this server has no key to open it", async () => {
    vi.stubEnv("PRISM_VAULT_KEY", "");
    rpc.mockResolvedValue({ data: sealFeedSnapshot(snapshot, randomBytes(32)), error: null });
    expect((await get()).status).toBe(404);
  });
});
