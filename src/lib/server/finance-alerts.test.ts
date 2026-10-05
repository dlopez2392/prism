// What a person's own visit leaves for the alert email job (finance.ts,
// rememberAlerts): a sealed snapshot after the response, only when their
// emails are on, at most every quarter hour unless the last one is under an
// older vault key or in a language they've just left; none for a connected
// app; and the last one forgotten once nothing of theirs is live. The same
// visit keeps the language they read Prism in with their account, for the
// emails, only when it moved.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaidAccount } from "@/lib/plaid/client";

vi.mock("server-only", () => ({}));
const scheduled: (() => unknown)[] = [];
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (fn: () => unknown) => void scheduled.push(fn) }));
/** What the browser asks for, as its Accept-Language. */
const browser = { language: "" };
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false }),
  headers: async () => new Headers(browser.language ? { "accept-language": browser.language } : {}),
}));
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => ({ userId: "u1", email: "a@x.test", supabase: {} }) }));

const checking: PlaidAccount = { account_id: "chk", name: "Checking", official_name: null, mask: "0001", type: "depository", subtype: "checking", balances: { available: 800, current: 800, iso_currency_code: "USD" } };
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const state = {
  alerts: { on: true, kinds: ["bank", "bill-short", "price-rise", "weekly"], amounts: true, takenAt: null as string | null, stale: false },
  linked: true,
  language: "en",
  feedUpdatedAt: null as string | null,
};
const saveAlertSnapshot = vi.fn<(account: unknown, snapshot: unknown, key: unknown) => Promise<void>>(async () => undefined);
const forgetAlertSnapshot = vi.fn(async () => undefined);
const saveAccountLanguage = vi.fn<(account: unknown, language: unknown) => Promise<void>>(async () => undefined);
const saveFeedSnapshot = vi.fn<(account: unknown, snapshot: unknown, key: unknown) => Promise<void>>(async () => undefined);
vi.mock("./account-store", () => ({
  loadAccount: async () => ({
    firstName: null,
    timeZone: "UTC",
    language: state.language,
    plan: { budgets: null, goals: null },
    categories: { v: 1, merchants: {}, transactions: {} },
    manual: [],
    homeValues: [],
    imports: [],
    lockedImports: [],
    wallets: [],
    inHousehold: false,
    coinbaseShared: null,
    items: state.linked ? [{ itemId: "item-1", accessToken: "access-production-1", institutionId: null, institutionName: "First Bank", linkedAt: "2026-09-30" }] : [],
    plaidSync: new Map(
      state.linked ? [["item-1", { state: { v: 1, cursor: "c-1", ready: true, accounts: [checking], transactions: [] }, version: 3, syncedAt: ago(60_000), changedAt: null }]] : [],
    ),
    coinbase: null,
    feedUpdatedAt: state.feedUpdatedAt,
    alerts: state.alerts,
    reseal: null,
  }),
  saveAlertSnapshot,
  forgetAlertSnapshot,
  clearBankAttention: vi.fn(),
  liveCoinbaseToken: vi.fn(),
  saveAccountPlaidSync: vi.fn(async () => true),
  saveAccountLanguage,
  saveAccountTimeZone: vi.fn(),
  saveFeedSnapshot,
  saveCoinbaseValue: vi.fn(),
  saveWalletReadings: vi.fn(),
}));

async function ownVisit() {
  vi.resetModules();
  const { getPersonalFinance } = await import("./finance");
  const data = await getPersonalFinance();
  for (const fn of scheduled.splice(0)) await fn();
  return data;
}

describe("what a visit leaves for alert emails", () => {
  beforeEach(() => {
    vi.stubEnv("PLAID_CLIENT_ID", "id");
    vi.stubEnv("PLAID_SECRET", "secret");
    vi.stubEnv("PRISM_VAULT_KEY", randomBytes(32).toString("base64"));
    state.alerts = { on: true, kinds: ["bank", "bill-short", "price-rise", "weekly"], amounts: true, takenAt: null, stale: false };
    state.linked = true;
    state.language = "en";
    state.feedUpdatedAt = null;
    browser.language = "";
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    saveAlertSnapshot.mockClear();
    forgetAlertSnapshot.mockClear();
    saveAccountLanguage.mockClear();
    saveFeedSnapshot.mockClear();
    scheduled.length = 0;
  });

  it("is a snapshot of the person's own money, taken after the response, with their choices on the page", async () => {
    const data = await ownVisit();
    expect(data.account?.alerts).toEqual({ on: true, kinds: ["bank", "bill-short", "price-rise", "weekly"], amounts: true });
    expect(saveAlertSnapshot).toHaveBeenCalledTimes(1);
    const [account, snap] = saveAlertSnapshot.mock.calls[0]!;
    expect(account).toMatchObject({ userId: "u1" });
    expect(snap).toMatchObject({ v: 1, today: data.today, weekly: expect.any(Object) });
  });

  it("is nothing at all while their emails are off", async () => {
    state.alerts = { ...state.alerts, on: false, takenAt: ago(60 * 60_000) };
    await ownVisit();
    expect(saveAlertSnapshot).not.toHaveBeenCalled();
    expect(forgetAlertSnapshot).not.toHaveBeenCalled();
  });

  it("waits a quarter hour between snapshots, unless the last is sealed under an older key", async () => {
    state.alerts = { ...state.alerts, takenAt: ago(5 * 60_000) };
    await ownVisit();
    expect(saveAlertSnapshot).not.toHaveBeenCalled();
    state.alerts = { ...state.alerts, stale: true };
    await ownVisit();
    expect(saveAlertSnapshot).toHaveBeenCalledTimes(1);
    state.alerts = { ...state.alerts, stale: false, takenAt: ago(16 * 60_000) };
    await ownVisit();
    expect(saveAlertSnapshot).toHaveBeenCalledTimes(2);
  });

  it("is never the example household's: with nothing of theirs live, the last one is forgotten", async () => {
    state.linked = false;
    state.alerts = { ...state.alerts, takenAt: ago(60 * 60_000) };
    await ownVisit();
    expect(saveAlertSnapshot).not.toHaveBeenCalled();
    expect(forgetAlertSnapshot).toHaveBeenCalledTimes(1);
  });

  it("keeps the language they read Prism in with their account, after the response, only when it moved, and words the snapshot in it", async () => {
    await ownVisit();
    expect(saveAccountLanguage).not.toHaveBeenCalled();
    expect(saveAlertSnapshot.mock.calls[0]![1]).toMatchObject({ lang: "en" });

    browser.language = "es-MX,es;q=0.9,en;q=0.5";
    await ownVisit();
    expect(saveAccountLanguage).toHaveBeenCalledTimes(1);
    expect(saveAccountLanguage.mock.calls[0]).toEqual([expect.objectContaining({ userId: "u1" }), "es"]);
    expect(saveAlertSnapshot.mock.calls[1]![1]).toMatchObject({ lang: "es" });

    state.language = "es";
    await ownVisit();
    expect(saveAccountLanguage).toHaveBeenCalledTimes(1);
  });

  it("words the snapshot again at once when they've just changed language, rather than waiting the quarter hour", async () => {
    state.alerts = { ...state.alerts, takenAt: ago(60_000) };
    browser.language = "es";
    await ownVisit();
    expect(saveAlertSnapshot).toHaveBeenCalledTimes(1);
    expect(saveAlertSnapshot.mock.calls[0]![1]).toMatchObject({ lang: "es" });
    // Once the account has it, the quarter hour stands again.
    state.language = "es";
    await ownVisit();
    expect(saveAlertSnapshot).toHaveBeenCalledTimes(1);
  });

  it("rewrites the calendar feed in the language they've just changed to, and otherwise every six hours", async () => {
    // No feed, nothing to write.
    browser.language = "es";
    await ownVisit();
    expect(saveFeedSnapshot).not.toHaveBeenCalled();
    // A feed written a minute ago in English, and a visit in Spanish: at once, in Spanish.
    state.feedUpdatedAt = ago(60_000);
    await ownVisit();
    expect(saveFeedSnapshot).toHaveBeenCalledTimes(1);
    expect(saveFeedSnapshot.mock.calls[0]![1]).toMatchObject({ v: 1, lang: "es" });
    // Once the account has it, a recent feed is left alone, and a stale one is written in it.
    state.language = "es";
    await ownVisit();
    expect(saveFeedSnapshot).toHaveBeenCalledTimes(1);
    state.feedUpdatedAt = ago(7 * 60 * 60_000);
    await ownVisit();
    expect(saveFeedSnapshot).toHaveBeenCalledTimes(2);
    expect(saveFeedSnapshot.mock.calls[1]![1]).toMatchObject({ lang: "es" });
  });

  it("is never left by a connected app", async () => {
    vi.resetModules();
    const { agentFinance } = await import("./finance");
    await agentFinance({ userId: "u1", email: "a@x.test", supabase: {} } as never);
    for (const fn of scheduled.splice(0)) await fn();
    expect(saveAlertSnapshot).not.toHaveBeenCalled();
    expect(forgetAlertSnapshot).not.toHaveBeenCalled();
    // Nor does a connected app's read move the language the emails go in.
    expect(saveAccountLanguage).not.toHaveBeenCalled();
  });
});
