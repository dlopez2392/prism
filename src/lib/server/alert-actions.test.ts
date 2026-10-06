// Turning alert emails on or off (alert-actions.ts): only for someone signed
// in, only where the job can run, only choices Prism offers, at least one of
// them when on, and off saves only that, so the choices wait for next time.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const signedIn = { current: { userId: "u1", email: "a@x.test", supabase: {} } as unknown };
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => signedIn.current }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/i18n/server", async () => ({ getT: async () => (await import("@/lib/i18n/t")).EN }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
const saveAlertSettings = vi.fn<(account: unknown, settings: unknown) => Promise<void>>(async () => undefined);
vi.mock("./account-store", () => ({ saveAlertSettings }));

const { saveAlertEmails } = await import("./alert-actions");
const IDLE = { status: "idle" } as const;

function form(fields: [string, string][]) {
  const f = new FormData();
  for (const [k, v] of fields) f.append(k, v);
  return f;
}

describe("saving alert email choices", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("CRON_SECRET", "s".repeat(44));
    signedIn.current = { userId: "u1", email: "a@x.test", supabase: {} };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    saveAlertSettings.mockClear();
  });

  it("keeps the kinds Prism offers, once each, and whether amounts may show", async () => {
    const state = await saveAlertEmails(IDLE, form([["on", "on"], ["kinds", "bank"], ["kinds", "weekly"], ["kinds", "weekly"], ["kinds", "everything"]]));
    expect(state).toMatchObject({ status: "saved" });
    expect(saveAlertSettings).toHaveBeenCalledWith(signedIn.current, { on: true, kinds: ["bank", "weekly"], amounts: false, refresh: false });
  });

  it("keeps whether Prism may check their banks each morning", async () => {
    await saveAlertEmails(IDLE, form([["on", "on"], ["kinds", "bill-short"], ["refresh", "on"]]));
    expect(saveAlertSettings).toHaveBeenCalledWith(signedIn.current, { on: true, kinds: ["bill-short"], amounts: false, refresh: true });
  });

  it("asks for at least one kind when they're on", async () => {
    const state = await saveAlertEmails(IDLE, form([["on", "on"], ["amounts", "on"]]));
    expect(state).toMatchObject({ status: "error", fields: { kinds: expect.stringMatching(/at least one/) } });
    expect(saveAlertSettings).not.toHaveBeenCalled();
  });

  it("saves only 'off' when they're turned off, whatever else was sent", async () => {
    await saveAlertEmails(IDLE, form([["kinds", "bank"]]));
    expect(saveAlertSettings).toHaveBeenCalledWith(signedIn.current, { on: false });
  });

  it("refuses where the job can't run, and sends someone signed out to sign in", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(await saveAlertEmails(IDLE, form([["on", "on"], ["kinds", "bank"]]))).toMatchObject({ status: "error" });
    signedIn.current = null;
    await expect(saveAlertEmails(IDLE, form([]))).rejects.toThrow(/redirect \/sign-in/);
    expect(saveAlertSettings).not.toHaveBeenCalled();
  });

  it("says so when the save doesn't land", async () => {
    saveAlertSettings.mockRejectedValueOnce(new Error("down"));
    expect(await saveAlertEmails(IDLE, form([["on", "on"], ["kinds", "bank"]]))).toMatchObject({ status: "error", message: expect.stringMatching(/couldn't save/) });
  });
});
