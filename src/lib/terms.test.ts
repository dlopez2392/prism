// The Terms of Service make promises about what Prism does. These hold the
// code to them: a bank or Coinbase permission that could do more than read,
// accounts outside the United States, or a way to create an account without
// the Terms in view, each fails here until the Terms change first.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COINBASE_SCOPES } from "@/lib/coinbase/client";
import { LINK_COUNTRIES, LINK_OPTIONAL_PRODUCTS, LINK_PRODUCTS } from "@/lib/plaid/client";
import { MINIMUM_AGE, READ_ONLY_PLAID_PRODUCTS, TERMS_CONTACT, TERMS_UPDATED } from "./terms";

const SRC = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(SRC, file), "utf8");

describe("the Terms of Service", () => {
  it("promise Prism can never move money, so every bank permission it asks for only reads", () => {
    const asked: string[] = [...LINK_PRODUCTS, ...LINK_OPTIONAL_PRODUCTS];
    expect(asked.filter((p) => !(READ_ONLY_PLAID_PRODUCTS as readonly string[]).includes(p))).toEqual([]);
    // The ones that could move money or reveal account numbers are never on the list.
    for (const p of ["transfer", "payment_initiation", "auth", "signal", "identity"]) expect(READ_ONLY_PLAID_PRODUCTS).not.toContain(p);
  });

  it("and every Coinbase permission only reads", () => {
    for (const scope of COINBASE_SCOPES) expect(scope === "offline_access" || /:read$/.test(scope), scope).toBe(true);
  });

  it("say accounts are for people in the United States, which is the only country banks are linked in", () => {
    expect([...LINK_COUNTRIES]).toEqual(["US"]);
    expect(MINIMUM_AGE).toBe(18);
  });

  it("are in view where an account is created, and one tap away from every page", () => {
    const signIn = read("components/sign-in-form.tsx");
    expect(signIn).toContain('href="/terms"');
    expect(signIn).toContain('href="/privacy"');
    expect(read("app/layout.tsx")).toContain('href="/terms"');
  });

  it("carry a date and a mailbox someone reads", () => {
    expect(Number.isNaN(Date.parse(TERMS_UPDATED))).toBe(false);
    expect(TERMS_CONTACT).toMatch(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/);
  });
});
