import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { CoinbaseConfig } from "@/lib/coinbase/client";
import { finishSignIn, needsRefresh, readLink, redirectUriFor, refreshLink, REFRESH_MARGIN_MS, sealLink, startSignIn } from "./coinbase-store";

const key = randomBytes(32);
const other = randomBytes(32);
const NOW = 1_790_000_000_000;
const config: CoinbaseConfig = { clientId: "cid", clientSecret: "s", redirectUri: null, loginUrl: "https://login.example", apiUrl: "https://api.example" };

const sealed = (expiresAt: number) => sealLink({ accessToken: "at1", refreshToken: "rt1", expiresAt }, "2026-09-01T00:00:00.000Z", key);

describe("the sealed link", () => {
  it("round-trips, and is unreadable with any other key or after tampering", () => {
    const raw = sealed(NOW + 3_600_000);
    expect(readLink(raw, key)).toEqual({ v: 1, accessToken: "at1", refreshToken: "rt1", expiresAt: NOW + 3_600_000, linkedAt: "2026-09-01T00:00:00.000Z" });
    expect(readLink(raw, other)).toBeNull();
    expect(readLink(raw.slice(0, -2) + (raw.endsWith("A") ? "BB" : "AA"), key)).toBeNull();
    expect(readLink(undefined, key)).toBeNull();
  });

  it("is due a refresh in its last five minutes", () => {
    expect(needsRefresh({ accessToken: "a", refreshToken: "r", expiresAt: NOW + REFRESH_MARGIN_MS + 1 }, NOW)).toBe(false);
    expect(needsRefresh({ accessToken: "a", refreshToken: "r", expiresAt: NOW + REFRESH_MARGIN_MS - 1 }, NOW)).toBe(true);
  });
});

describe("refreshLink", () => {
  it("does nothing, and calls nobody, while the token is fresh", async () => {
    const fetchImpl = vi.fn();
    expect(await refreshLink(sealed(NOW + 3_600_000), key, config, fetchImpl as unknown as typeof fetch, NOW)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("spends the refresh token once and returns the new pair sealed, keeping the link date", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: "at2", refresh_token: "rt2", expires_in: 3600 }), { status: 200 }));
    const next = await refreshLink(sealed(NOW + 60_000), key, config, fetchImpl as unknown as typeof fetch, NOW);
    expect(new URLSearchParams(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).get("refresh_token")).toBe("rt1");
    expect(readLink(next!, key)).toEqual({ v: 1, accessToken: "at2", refreshToken: "rt2", expiresAt: NOW + 3_600_000, linkedAt: "2026-09-01T00:00:00.000Z" });
  });

  it("returns null on failure so the caller leaves the cookie alone", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 }));
    expect(await refreshLink(sealed(NOW - 1), key, config, fetchImpl as unknown as typeof fetch, NOW)).toBeNull();
  });
});

describe("the sign-in round trip", () => {
  it("binds the return to this browser's state and hands back the PKCE verifier", () => {
    const start = startSignIn("https://prism.example/api/coinbase/callback", key, NOW);
    const done = finishSignIn(start.cookie, start.state, key, NOW + 60_000);
    expect(done!.redirectUri).toBe("https://prism.example/api/coinbase/callback");
    expect(createHash("sha256").update(done!.verifier).digest("base64url")).toBe(start.challenge);
  });

  it("refuses a forged state, a foreign cookie, a missing cookie and a stale attempt", () => {
    const start = startSignIn("https://r", key, NOW);
    expect(finishSignIn(start.cookie, "not-the-state", key, NOW)).toBeNull();
    expect(finishSignIn(start.cookie, null, key, NOW)).toBeNull();
    expect(finishSignIn(start.cookie, start.state, other, NOW)).toBeNull();
    expect(finishSignIn(undefined, start.state, key, NOW)).toBeNull();
    expect(finishSignIn(start.cookie, start.state, key, NOW + 11 * 60_000)).toBeNull();
  });

  it("makes a new state and verifier every time", () => {
    const a = startSignIn("https://r", key, NOW);
    const b = startSignIn("https://r", key, NOW);
    expect(a.state).not.toBe(b.state);
    expect(a.challenge).not.toBe(b.challenge);
    expect(a.state.length).toBeGreaterThanOrEqual(32);
  });

  it("uses the registered redirect when one is set, else this origin's callback", () => {
    expect(redirectUriFor(config, "https://prism.example")).toBe("https://prism.example/api/coinbase/callback");
    expect(redirectUriFor({ ...config, redirectUri: "https://fixed.example/cb" }, "https://prism.example")).toBe("https://fixed.example/cb");
  });
});

describe("the proxy matcher", () => {
  it("names the same cookie the store writes (it has to be a literal there)", async () => {
    const { readFileSync } = await import("node:fs");
    const { COINBASE_COOKIE } = await import("./coinbase-store");
    const proxy = readFileSync(new URL("../../proxy.ts", import.meta.url), "utf8");
    expect(proxy).toContain(`key: "${COINBASE_COOKIE}"`);
  });
});
