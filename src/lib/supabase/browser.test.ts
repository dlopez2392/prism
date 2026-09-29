// The browser's code check: codes are tidied and shape-checked before
// Supabase sees them, the session cookie is Prism's own, and every refusal
// comes back in words.

import { beforeEach, describe, expect, it, vi } from "vitest";

const verify = vi.fn();
const created: { url: string; key: string; options: Record<string, unknown> }[] = [];

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: (url: string, key: string, options: Record<string, unknown>) => {
    created.push({ url, key, options });
    return { auth: { mfa: { challengeAndVerify: verify } } };
  },
}));

const { checkCode } = await import("./browser");
const env = { url: "https://ref.supabase.co", key: "pk" };

beforeEach(() => {
  verify.mockReset();
  created.length = 0;
});

describe("checking a code in the browser", () => {
  it("tidies the code, checks it against the given authenticator, and keeps the session in prism-auth", async () => {
    verify.mockResolvedValue({ data: {}, error: null });
    expect(await checkCode(env, "f1", " 123-456 ")).toEqual({ ok: true });
    expect(verify).toHaveBeenCalledWith({ factorId: "f1", code: "123456" });
    expect(created[0]?.options).toMatchObject({ cookieOptions: { name: "prism-auth" }, auth: { autoRefreshToken: false, detectSessionInUrl: false } });
  });

  it("never sends something that isn't a 6-digit code", async () => {
    expect(await checkCode(env, "f1", "12ab56")).toMatchObject({ ok: false, error: expect.stringMatching(/6-digit/) });
    expect(await checkCode(env, "f1", "1234567")).toMatchObject({ ok: false });
    expect(verify).not.toHaveBeenCalled();
  });

  it("says why in words: wrong code, too many tries, or no connection", async () => {
    verify.mockResolvedValueOnce({ data: null, error: { status: 422, code: "mfa_verification_failed" } });
    expect(await checkCode(env, "f1", "123456")).toMatchObject({ ok: false, error: expect.stringMatching(/didn't match/) });
    verify.mockResolvedValueOnce({ data: null, error: { status: 429, code: "over_request_rate_limit" } });
    expect(await checkCode(env, "f1", "123456")).toMatchObject({ ok: false, error: expect.stringMatching(/lot of tries/) });
    verify.mockResolvedValueOnce({ data: null, error: { status: 422, code: "mfa_challenge_expired" } });
    expect(await checkCode(env, "f1", "123456")).toMatchObject({ ok: false, error: expect.stringMatching(/didn't match/) });
    verify.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await checkCode(env, "f1", "123456")).toMatchObject({ ok: false, error: expect.stringMatching(/connection/) });
    verify.mockResolvedValueOnce({ data: null, error: { status: 403, code: "session_not_found" } });
    expect(await checkCode(env, "f1", "123456")).toMatchObject({ ok: false, error: expect.stringMatching(/Sign in again/) });
  });

  it("never blames the code for a problem the code can't fix", async () => {
    // What supabase-js returns, rather than throws, when the request never lands.
    for (const error of [{ status: 0, code: undefined }, { status: 500, code: "unexpected_failure" }, { status: 422, code: "mfa_ip_address_mismatch" }]) {
      verify.mockResolvedValueOnce({ data: null, error });
      expect(await checkCode(env, "f1", "123456")).toMatchObject({ ok: false, error: expect.stringMatching(/couldn't check/) });
    }
  });
});
