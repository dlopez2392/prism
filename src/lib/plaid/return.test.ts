// Banks that sign people in on their own website (Chase, Bank of America…)
// send them back to /connections/return. These are the rules for the address
// Prism gives Plaid, and for what Prism remembers while the person is away.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLinkToken, redirectUriFor, RETURN_PATH, type PlaidConfig } from "./client";
import { clearedReturnCookie, packReturn, readReturn, RETURN_COOKIE, RETURN_FALLBACK, returnCookieOptions, returnPath, returnView } from "./return";

const SITE = "https://prism.bis-rgv.com";
const RETURN = `${SITE}${RETURN_PATH}`;

describe("the return address Prism gives Plaid", () => {
  it("is left out until the operator sets one — Plaid refuses an address it hasn't allow-listed", () => {
    expect(redirectUriFor({}, SITE, "production")).toEqual({ uri: null, problem: null });
    expect(redirectUriFor({ PLAID_REDIRECT_URI: "  " }, SITE, "production")).toEqual({ uri: null, problem: null });
  });

  it("is sent when it is exactly this site's return page", () => {
    expect(redirectUriFor({ PLAID_REDIRECT_URI: RETURN }, SITE, "production")).toEqual({ uri: RETURN, problem: null });
    expect(redirectUriFor({ PLAID_REDIRECT_URI: "http://localhost:3100/connections/return" }, "http://localhost:3100", "sandbox").uri).toBe(
      "http://localhost:3100/connections/return",
    );
  });

  it("is refused, with the reason, in any shape the return page couldn't resume from", () => {
    const wrong = [
      "not a url",
      `http://prism.bis-rgv.com${RETURN_PATH}`, // plain http off localhost
      `${RETURN}/`, // trailing slash: the page would see a different address than Plaid expects
      `${RETURN}?from=x`, // Plaid appends its own query
      `${RETURN}?`,
      `${RETURN}#done`,
      `${SITE}/connections`, // another page, which wouldn't resume anything
      `https://user:pw@prism.bis-rgv.com${RETURN_PATH}`,
      `https://PRISM.bis-rgv.com${RETURN_PATH}`, // not in normal form, so not what the page will see
    ];
    for (const PLAID_REDIRECT_URI of wrong) {
      const r = redirectUriFor({ PLAID_REDIRECT_URI }, SITE, "production");
      expect(r.uri, PLAID_REDIRECT_URI).toBeNull();
      expect(r.problem, PLAID_REDIRECT_URI).toMatch(/PLAID_REDIRECT_URI/);
    }
    // Plain http for localhost is a sandbox convenience only.
    expect(redirectUriFor({ PLAID_REDIRECT_URI: "http://localhost:3100/connections/return" }, "http://localhost:3100", "production").uri).toBeNull();
  });

  it("is left out for a request that reached Prism on another hostname, where the return would find none of its cookies", () => {
    const r = redirectUriFor({ PLAID_REDIRECT_URI: RETURN }, "https://prism-dun-one.vercel.app", "production");
    expect(r.uri).toBeNull();
    expect(r.problem).toMatch(/prism-dun-one\.vercel\.app/);
  });
});

describe("the Link token request", () => {
  const config: PlaidConfig = { clientId: "c", secret: "s", env: "sandbox", host: "https://plaid.test" };
  let sent: Record<string, unknown>[] = [];
  beforeEach(() => {
    sent = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ link_token: "link-sandbox-abc", expiration: "2026-09-28T23:00:00Z" });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("carries the return address only when there is one", async () => {
    await createLinkToken(config, "u1", { redirectUri: RETURN }, {});
    await createLinkToken(config, "u1", {}, { PLAID_REDIRECT_URI: RETURN });
    expect(sent[0]!.redirect_uri).toBe(RETURN);
    // The raw setting alone is never sent: it goes through redirectUriFor first.
    expect(sent[1]).not.toHaveProperty("redirect_uri");
  });
});

describe("what Prism remembers while the person is at their bank", () => {
  it("is the Link token and the page they started from", () => {
    const packed = packReturn({ linkToken: "link-production-9f3c-11aa", back: "/budgets" });
    expect(readReturn(packed)).toEqual({ linkToken: "link-production-9f3c-11aa", back: "/budgets" });
    // Opaque to a casual look, and cookie-safe as it stands.
    expect(packed).toMatch(/^[\w-]+$/);
  });

  it("is nothing when the cookie isn't one of ours", () => {
    const junk = [undefined, "", "%%%", Buffer.from("[]").toString("base64url"), packReturn({ linkToken: "public-sandbox-x", back: "/" }), "x".repeat(3000)];
    for (const raw of junk) expect(readReturn(raw)).toBeNull();
  });

  it("goes back only to a page on this site, and never to the return page itself", () => {
    expect(returnPath("/spending?month=2026-09")).toBe("/spending?month=2026-09");
    for (const bad of ["https://evil.example/", "//evil.example", "/\\evil.example", "/./", "/connections/return?oauth_state_id=x", 42, null]) {
      expect(returnPath(bad), String(bad)).toBe(RETURN_FALLBACK);
    }
    expect(readReturn(Buffer.from(JSON.stringify({ t: "link-sandbox-a", b: "//evil.example" })).toString("base64url"))?.back).toBe(RETURN_FALLBACK);
  });

  it("lives in a cookie only this exact site can set, script can't read, and that is cleared the way it was set", () => {
    // __Host-: no sibling subdomain can plant its own Link token here.
    expect(RETURN_COOKIE).toBe("__Host-prism-bank-return");
    expect(returnCookieOptions()).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 3600 });
    // A browser ignores a __Host- clear that isn't Secure with Path=/.
    expect(clearedReturnCookie()).toEqual({ ...returnCookieOptions(), maxAge: 0 });
  });
});

describe("what the return page shows", () => {
  const saved = packReturn({ linkToken: "link-sandbox-abc", back: "/goals" });

  it("reopens Link only when a bank sent the person here AND their Link token is waiting", () => {
    expect(returnView("0f1e2d3c-state", saved)).toEqual({ kind: "resume", linkToken: "link-sandbox-abc", back: "/goals" });
  });

  it("says there's nothing left to finish when a bank sent them but nothing waits — already done, too slow, or another browser", () => {
    expect(returnView("0f1e2d3c-state", undefined)).toEqual({ kind: "unfinished" });
    expect(returnView("0f1e2d3c-state", "tampered")).toEqual({ kind: "unfinished" });
  });

  it("explains itself when no bank sent them, even with a Link token waiting", () => {
    for (const id of [undefined, "", ["a", "b"]]) expect(returnView(id, saved)).toEqual({ kind: "empty" });
  });
});
