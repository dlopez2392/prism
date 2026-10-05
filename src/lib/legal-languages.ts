// src/lib/legal-languages.ts
//
// Which legal pages (/privacy, /terms) read in Spanish. The English text is
// the one that governs, so each Spanish translation is held until a lawyer
// has read it against a particular English version, and shows only while
// that is still the English in force:
//
//   SPANISH_TRANSLATED_FROM  the English version ("Last updated" date) each
//                            translation was made from. legal-spanish.test.ts
//                            keeps it equal to the English page's own date,
//                            so the English can't change without its Spanish.
//   SPANISH_APPROVED         the English version a lawyer approved each
//                            translation against; null while it's held.
//
// A page reads in Spanish only when the two dates match. Changing the
// English moves SPANISH_TRANSLATED_FROM (with new Spanish) past the approved
// date, so the page goes back to English on its own until the new Spanish is
// approved too. Until then it stays in ENGLISH_ONLY (locale.ts), and a
// Spanish page marks it English for screen readers.

export type LegalPage = "privacy" | "terms";

export const LEGAL_PATHS: Record<LegalPage, string> = { privacy: "/privacy", terms: "/terms" };

export const SPANISH_TRANSLATED_FROM: Record<LegalPage, string> = { privacy: "October 5, 2026", terms: "September 30, 2026" };

export const SPANISH_APPROVED: Record<LegalPage, string | null> = { privacy: null, terms: null };

/** Whether a translation made from `translatedFrom` may show, given what a lawyer approved. */
export function approvedFor(approved: string | null, translatedFrom: string): boolean {
  return approved !== null && approved === translatedFrom;
}

/** Whether this page reads in Spanish for someone who reads Prism in Spanish. */
export function spanishPublished(page: LegalPage): boolean {
  return approvedFor(SPANISH_APPROVED[page], SPANISH_TRANSLATED_FROM[page]);
}
