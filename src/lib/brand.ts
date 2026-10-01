// src/lib/brand.ts
//
// Who makes Prism. Every place the product or company is named reads from
// here, so a rename is one edit.

export const BRAND = {
  product: "Prism",
  tagline: "Your money, in full colour.",
  company: "Bespoke Intelligence Solutions",
  companyShort: "BIS",
  /** Production's address: links handed to connected apps, which a person opens to check a figure. */
  site: "https://prism.bis-rgv.com",
  /** Privacy questions and requests (the privacy policy). Must be a mailbox someone reads. */
  privacyEmail: "privacy@bis-rgv.com",
} as const;

/**
 * The page colour in each theme (tokens.css --surface-0), for the few places
 * that can't read a token: the browser's own bar, and the installed app's
 * launch screen. brand.test.ts keeps them equal to the tokens.
 */
export const PAGE_COLORS = { light: "#f4f3fb", dark: "#0b0b1a" } as const;
