// src/lib/terms.ts
//
// The facts the Terms of Service (/terms) rest on, as data, so the promises it
// makes can be checked against the code. terms.test.ts fails if Prism starts
// asking a bank or Coinbase for anything that isn't read-only, or for accounts
// outside the United States, without the Terms changing first.

import { BRAND } from "@/lib/brand";

/** Shown on the page. Change it whenever the Terms' substance changes. */
export const TERMS_UPDATED = "October 6, 2026";

/** Where questions about the Terms go. The same mailbox as privacy requests: one address people can remember. */
export const TERMS_CONTACT = BRAND.privacyEmail;

/** Who can open an account and connect accounts. */
export const MINIMUM_AGE = 18;

/** What Plaid products the Terms (and the privacy policy) describe. Every one only reads. */
export const READ_ONLY_PLAID_PRODUCTS = ["transactions", "investments", "liabilities"] as const;

/** What the operator has switched on that the Terms' words follow (app/terms/switches.ts). */
export type TermsSwitches = { billing: boolean };

/** At least this much notice before a price change applies to someone already subscribed. */
export const PRICE_NOTICE_DAYS = 30;

/** At least this much notice before Prism is ever shut down, where we can give it. */
export const SHUTDOWN_NOTICE_DAYS = 30;

/** The floor of the liability cap: the greater of what you paid us in the last 12 months, or this. */
export const LIABILITY_FLOOR_USD = 100;

/** Where good-faith security research is welcome. */
export const SECURITY_POLICY_URL = "https://github.com/dlopez2392/prism/security/policy";
