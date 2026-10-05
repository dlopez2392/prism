// Two-step sign-in's server actions, against a fake of Supabase that records
// every call in order. Codes are checked in the browser, so what's proved here
// is what the server adds: an abandoned set-up is cleared, turning it off
// needs a code entered in the last five minutes (read from the token, never
// from the request), and the record is cleared before the authenticator goes.

import { beforeEach, describe, expect, it, vi } from "vitest";

const FACTOR = "7366e259-aacd-4c68-846f-d23180212bdb";
const calls: string[] = [];
let registered: string | null = FACTOR;
let unverified: { id: string; factor_type: string; status: string }[] = [];
let amr: unknown = [];
let updateError: { message: string } | null = null;

const supabase = {
  rpc: async (name: string) => (calls.push(`rpc:${name}`), { data: name === "my_second_step_factor" ? registered : null, error: null }),
  from: (table: string) => ({
    update: (row: Record<string, unknown>) => ({
      eq: async () => (calls.push(`update:${table}:${JSON.stringify(row)}`), { error: updateError }),
    }),
  }),
  auth: {
    getClaims: async () => ({ data: { claims: { sub: "u1", amr } }, error: null }),
    mfa: {
      unenroll: async ({ factorId }: { factorId: string }) => (calls.push(`unenroll:${factorId}`), { data: {}, error: null }),
      listFactors: async () => ({ data: { all: unverified }, error: null }),
      enroll: async (params: Record<string, unknown>) => (
        calls.push(`enroll:${JSON.stringify(params)}`),
        { data: { id: "new-factor", totp: { qr_code: "data:image/svg+xml;utf-8,<svg/>", secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://x" } }, error: null }
      ),
    },
  },
};
const account = { supabase, userId: "u1", email: "a@x.test" };
let signedIn: typeof account | null = account;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: () => calls.push("refresh") }));
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => signedIn }));
vi.mock("@/lib/i18n/server", async () => ({ getT: async () => (await import("@/lib/i18n/t")).EN }));

const { registerFactor, startSetup, turnOff } = await import("./two-step-actions");

const now = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  calls.length = 0;
  registered = FACTOR;
  unverified = [];
  amr = [];
  updateError = null;
  signedIn = account;
});

describe("turning it on", () => {
  it("clears an abandoned set-up, then asks for a new authenticator named Prism", async () => {
    unverified = [
      { id: "old", factor_type: "totp", status: "unverified" },
      { id: "kept", factor_type: "totp", status: "verified" },
    ];
    const started = await startSetup();
    expect(started).toMatchObject({ ok: true, factorId: "new-factor", secret: "JBSWY3DPEHPK3PXP" });
    expect(calls[0]).toBe("unenroll:old");
    expect(calls).not.toContain("unenroll:kept");
    expect(calls[1]).toMatch(/^enroll:.*"issuer":"Prism"/);
  });

  it("records the authenticator it's given (the database refuses one this session hasn't just passed)", async () => {
    expect(await registerFactor(FACTOR)).toEqual({ ok: true });
    expect(calls).toEqual([`update:profiles:{"totp_factor_id":"${FACTOR}"}`, "refresh"]);
  });

  it("says so when the database refuses the record, and sends nothing that isn't a factor id", async () => {
    updateError = { message: "two-step: that authenticator hasn't been passed in this session" };
    expect(await registerFactor(FACTOR)).toMatchObject({ ok: false });
    expect(await registerFactor("'; drop table profiles; --")).toMatchObject({ ok: false });
    expect(calls).toEqual([`update:profiles:{"totp_factor_id":"${FACTOR}"}`]);
  });

  it("does nothing for someone not signed in", async () => {
    signedIn = null;
    expect(await startSetup()).toMatchObject({ ok: false });
    expect(await registerFactor(FACTOR)).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });
});

describe("turning it off", () => {
  it("with a code from the last five minutes, clears the record BEFORE removing the authenticator", async () => {
    amr = [
      { method: "otp", timestamp: now() - 3600 },
      { method: "totp", timestamp: now() - 20 },
    ];
    expect(await turnOff()).toEqual({ ok: true });
    expect(calls).toEqual(["rpc:my_second_step_factor", `update:profiles:{"totp_factor_id":null}`, `unenroll:${FACTOR}`, "refresh"]);
  });

  it("changes nothing when the last code is older than five minutes, missing, or in the timeless form", async () => {
    for (const stale of [[{ method: "totp", timestamp: now() - 301 }], [{ method: "otp", timestamp: now() }], ["totp"], undefined]) {
      amr = stale;
      expect(await turnOff()).toMatchObject({ ok: false, error: expect.stringMatching(/current code/) });
    }
    expect(calls.some((c) => c.startsWith("update:") || c.startsWith("unenroll:"))).toBe(false);
  });

  it("keeps the authenticator when the record can't be cleared", async () => {
    amr = [{ method: "totp", timestamp: now() }];
    updateError = { message: "network" };
    expect(await turnOff()).toMatchObject({ ok: false });
    expect(calls.some((c) => c.startsWith("unenroll:"))).toBe(false);
  });

  it("is already done when no authenticator is registered", async () => {
    registered = null;
    expect(await turnOff()).toEqual({ ok: true });
    expect(calls).toEqual(["rpc:my_second_step_factor", "refresh"]);
  });
});
