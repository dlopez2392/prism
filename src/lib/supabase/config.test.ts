import { describe, expect, it } from "vitest";
import { AUTH_COOKIE, hasSessionCookie, supabaseEnv } from "./config";

describe("supabaseEnv", () => {
  it("is off unless both public settings are present and the URL is a URL", () => {
    expect(supabaseEnv({})).toBeNull();
    expect(supabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" })).toBeNull();
    expect(supabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: "x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k" })).toBeNull();
  });

  it("trims, drops a trailing slash, and accepts the older anon-key name", () => {
    expect(supabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: " https://x.supabase.co/ ", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: " sb_publishable_1 " })).toEqual({
      url: "https://x.supabase.co",
      key: "sb_publishable_1",
    });
    expect(supabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJ" })!.key).toBe("eyJ");
  });
});

describe("hasSessionCookie", () => {
  it("spots a whole or chunked session and nothing else", () => {
    expect(hasSessionCookie([AUTH_COOKIE])).toBe(true);
    expect(hasSessionCookie(["prism-tz", `${AUTH_COOKIE}.0`])).toBe(true);
    expect(hasSessionCookie(["prism-tz", "prism-authx", "sb-abc-auth-token"])).toBe(false);
  });
});
