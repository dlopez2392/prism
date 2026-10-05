// The signed-in browser tests' one way to a database (stack.ts): the local
// stack, plainly on this machine, with its publishable key; never production,
// never another hosted project, never a secret key. Run by the unit suite.

import { describe, expect, it } from "vitest";
import { checkedStack, localStack, PRODUCTION_REF, refuseProduction } from "./stack";

const LOCAL = { API_URL: "http://127.0.0.1:54321", PUBLISHABLE_KEY: "sb_publishable_local-test-key", MAILPIT_URL: "http://127.0.0.1:54324" };

describe("the signed-in tests' database", () => {
  it("is the local stack as `supabase status` reports it", () => {
    expect(checkedStack(LOCAL)).toEqual({ url: "http://127.0.0.1:54321", key: LOCAL.PUBLISHABLE_KEY, mailpit: "http://127.0.0.1:54324" });
    expect(checkedStack({ ...LOCAL, API_URL: "http://localhost:54321/", MAILPIT_URL: undefined, INBUCKET_URL: "http://localhost:54324" }).mailpit).toBe("http://localhost:54324");
  });

  it("is never production, another hosted project, or anything dressed up as this machine", () => {
    for (const API_URL of [
      `https://${PRODUCTION_REF}.supabase.co`,
      "https://abcdefghijklmnopqrst.supabase.co",
      "https://127.0.0.1:54321",
      "http://127.0.0.1.example.com:54321",
      "http://localhost@example.com:54321",
      // This machine's address as a user name: the host is example.com.
      "http://127.0.0.1:54321@example.com",
      "http://10.0.0.5:54321",
      "",
    ]) {
      expect(() => checkedStack({ ...LOCAL, API_URL }), API_URL).toThrow(/loopback/);
    }
    expect(() => checkedStack({ ...LOCAL, MAILPIT_URL: "https://mail.example.com" })).toThrow(/Mailpit/);
  });

  it("takes only a publishable key, never the stack's secret or service-role key", () => {
    for (const PUBLISHABLE_KEY of ["sb_secret_not-a-real-key", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.x", ""]) {
      expect(() => checkedStack({ ...LOCAL, PUBLISHABLE_KEY })).toThrow(/publishable key/);
    }
  });

  it("refuses any setting that names production, saying which and never its value", () => {
    expect(() => refuseProduction({ NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` })).toThrow("Refusing to run browser tests: NEXT_PUBLIC_SUPABASE_URL names Prism's production project.");
    expect(() => refuseProduction({ A: "http://127.0.0.1:54321", B: undefined })).not.toThrow();
  });

  it("checks a stack handed down from the runner as strictly as one it read itself", () => {
    expect(localStack({ PRISM_E2E_STACK: JSON.stringify(LOCAL) })).toEqual(checkedStack(LOCAL));
    expect(() => localStack({ PRISM_E2E_STACK: JSON.stringify({ ...LOCAL, API_URL: `https://${PRODUCTION_REF}.supabase.co` }) })).toThrow(/loopback/);
  });
});
