// A shared Coinbase (finance.ts): the household's copy of its value is kept
// current from the OWNER's own visits only, after the response, from a live
// load, at most every ten minutes, and only while it's shared.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const scheduled: (() => unknown)[] = [];
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (fn: () => unknown) => void scheduled.push(fn) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, has: () => false }), headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => ({ userId: "u1", email: "a@x.test", supabase: {} }) }));

const reachable = { current: true };
vi.mock("@/lib/coinbase/client", async (original) => {
  const real = await original<typeof import("@/lib/coinbase/client")>();
  return {
    ...real,
    listAccounts: async () => {
      if (!reachable.current) throw new real.CoinbaseError(503, "down", "Coinbase is down");
      return [{ id: "w1", name: "BTC Wallet", type: "wallet", currency: { code: "BTC", name: "Bitcoin" }, balance: { amount: "0.5", currency: "BTC" } }];
    },
    // 0.5 BTC at 0.00002 BTC a dollar: $25,000.
    usdRates: async () => ({ BTC: 0.00002 }),
  };
});

const saveCoinbaseValue = vi.fn(async () => undefined);
const shared = { current: null as { balance: number | null; at: string | null } | null };
vi.mock("./account-store", () => ({
  loadAccount: async () => ({
    firstName: "Dana",
    timeZone: "UTC",
    plan: { budgets: null, goals: null },
    categories: { v: 1, merchants: {}, transactions: {} },
    manual: [],
    imports: [],
    lockedImports: [],
    wallets: [],
    inHousehold: true,
    coinbaseShared: shared.current,
    items: [],
    plaidSync: new Map(),
    coinbase: { tokens: { accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 3_600_000 }, version: 1, linkedAt: "2026-09-01" },
    feedUpdatedAt: null,
    reseal: null,
  }),
  liveCoinbaseToken: async () => "at",
  saveAccountPlaidSync: vi.fn(),
  saveAccountTimeZone: vi.fn(),
  saveFeedSnapshot: vi.fn(async () => undefined),
  saveCoinbaseValue,
}));

const LIVE = 2_500_000;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function visit() {
  vi.resetModules();
  const { getPersonalFinance } = await import("./finance");
  const data = await getPersonalFinance();
  for (const fn of scheduled.splice(0)) await fn();
  return data;
}

describe("the household's copy of a shared Coinbase", () => {
  beforeEach(() => {
    vi.stubEnv("PRISM_VAULT_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("COINBASE_CLIENT_ID", "id");
    vi.stubEnv("COINBASE_CLIENT_SECRET", "secret");
    reachable.current = true;
    shared.current = null;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    saveCoinbaseValue.mockClear();
    scheduled.length = 0;
  });

  it("is written on the owner's visit, after the response, the first time", async () => {
    shared.current = { balance: null, at: null };
    const data = await visit();
    expect(data.accounts.find((a) => a.source === "coinbase")?.balance).toBe(LIVE);
    expect(saveCoinbaseValue).toHaveBeenCalledTimes(1);
    expect(saveCoinbaseValue).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }), LIVE, expect.anything());
  });

  it("isn't written at all while Coinbase isn't shared", async () => {
    await visit();
    expect(saveCoinbaseValue).not.toHaveBeenCalled();
  });

  it("isn't rewritten when nothing moved, or more often than every ten minutes", async () => {
    shared.current = { balance: LIVE, at: minutesAgo(60) };
    await visit();
    shared.current = { balance: 1, at: minutesAgo(3) };
    await visit();
    expect(saveCoinbaseValue).not.toHaveBeenCalled();
    shared.current = { balance: 1, at: minutesAgo(11) };
    await visit();
    expect(saveCoinbaseValue).toHaveBeenCalledTimes(1);
  });

  it("keeps the last copy when Coinbase can't be reached, rather than copying nothing", async () => {
    shared.current = { balance: 1, at: minutesAgo(60) };
    reachable.current = false;
    await visit();
    expect(saveCoinbaseValue).not.toHaveBeenCalled();
  });
});
