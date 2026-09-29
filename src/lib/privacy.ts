// src/lib/privacy.ts
//
// The facts the privacy policy (/privacy) states, as data, so they can be
// checked against the code. privacy.test.ts fails when Prism sets a cookie or
// a browser-storage key that isn't listed here. A new one has to be declared
// to the people it's stored for before it ships.

import { BRAND } from "@/lib/brand";

/** Shown on the page. Change it whenever the policy's substance changes. */
export const POLICY_UPDATED = "September 29, 2026";

/** Where privacy questions and requests go. Must be a mailbox someone reads. */
export const PRIVACY_CONTACT = BRAND.privacyEmail;

export type StoredOnDevice = {
  name: string;
  kind: "Cookie" | "Browser storage";
  what: string;
  lasts: string;
  /** Set by a library Prism uses rather than by Prism's own code, so the source scan can't see it. */
  setByLibrary?: true;
};

/** Everything Prism keeps in the browser. All of it is needed to run Prism; none of it tracks you or serves ads. */
export const STORED_ON_DEVICE: StoredOnDevice[] = [
  { name: "prism-auth", kind: "Cookie", what: "Keeps you signed in to your Prism account.", lasts: "Until you sign out, or 400 days" },
  {
    name: "prism-auth-code-verifier",
    kind: "Cookie",
    what: "Makes the link in your sign-in email work only in the browser that asked for it.",
    lasts: "Until you finish signing in",
    setByLibrary: true,
  },
  { name: "prism-next", kind: "Cookie", what: "Remembers what you were doing when sign-in interrupted it, such as approving an AI app.", lasts: "15 minutes" },
  {
    name: "prism-vault",
    kind: "Cookie",
    what: "A bank connected on this device before connecting one needed an account, encrypted so only Prism's server can read it. Signing in moves it into your account.",
    lasts: "30 days",
  },
  { name: "__Host-prism-bank-return", kind: "Cookie", what: "Holds your connection in place while your bank signs you in on its own website.", lasts: "Up to 1 hour" },
  {
    name: "prism-coinbase",
    kind: "Cookie",
    what: "A Coinbase connection made on this device before connecting one needed an account, encrypted. Signing in moves it into your account.",
    lasts: "400 days",
  },
  { name: "prism-coinbase-oauth", kind: "Cookie", what: "Keeps a Coinbase sign-in secure while it's in progress.", lasts: "10 minutes" },
  { name: "prism-budgets", kind: "Cookie", what: "Budgets you set on this device without an account.", lasts: "400 days" },
  { name: "prism-goals", kind: "Cookie", what: "Goals you set on this device without an account.", lasts: "400 days" },
  { name: "prism-carryover", kind: "Cookie", what: "Remembers that you chose to decide later about moving this device's budgets and goals into your account.", lasts: "30 days" },
  { name: "prism-tz", kind: "Cookie", what: "Your time zone, so days and months line up with yours.", lasts: "1 year" },
  { name: "prism-theme", kind: "Browser storage", what: "Whether you picked light or dark.", lasts: "Until you clear it" },
];

export type Provider = { name: string; does: string; policy: string };

/** The companies that handle personal information to run Prism, and nothing else. */
export const PROVIDERS: Provider[] = [
  {
    name: "Plaid",
    does: "Connects your bank, card, loan and investment accounts. You sign in to your bank through Plaid, and Prism never sees your bank username or password.",
    policy: "https://plaid.com/legal/#end-user-privacy-policy",
  },
  { name: "Coinbase", does: "Shares your crypto balances, read-only, if you connect Coinbase.", policy: "https://www.coinbase.com/legal/privacy" },
  { name: "Supabase", does: "Runs Prism's database and sign-in, in the United States.", policy: "https://supabase.com/privacy" },
  { name: "Vercel", does: "Hosts the Prism website and servers, in the United States.", policy: "https://vercel.com/legal/privacy-policy" },
  { name: "Resend", does: "Sends your sign-in codes by email.", policy: "https://resend.com/legal/privacy-policy" },
];
