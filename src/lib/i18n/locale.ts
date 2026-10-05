// src/lib/i18n/locale.ts
//
// Which language Prism speaks: English or Spanish. A person picks with the
// EN | ES switch in the top bar (the same switch bis-rgv.com has); the choice
// is kept in a cookie, so every page renders in it from the server, with no
// flash and the same addresses in both. Until they pick, a browser that asks
// for Spanish first gets Spanish.

import { LEGAL_PATHS, spanishPublished, type LegalPage } from "@/lib/legal-languages";

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

/** The cookie that keeps the choice, on this device, for a year. */
export const LANG_COOKIE = "prism-lang";

export const LOCALE_NAMES: Record<Locale, string> = { en: "English", es: "Español" };

/** One of the languages Prism speaks: never free text from a cookie, a form or a database row. */
export function isLocale(x: unknown): x is Locale {
  return (LOCALES as readonly unknown[]).includes(x);
}

/**
 * The screens whose words are still only in English (docs/ROADMAP.md, item
 * 29). In Spanish, their content is marked English (components/locale.tsx),
 * so a screen reader reads it in an English voice. Only the legal pages are
 * left, and each comes off the list on its own once a lawyer has approved its
 * Spanish against the English in force (legal-languages.ts).
 */
export const ENGLISH_ONLY: string[] = (Object.keys(LEGAL_PATHS) as LegalPage[]).filter((page) => !spanishPublished(page)).map((page) => LEGAL_PATHS[page]);

/** Whether a screen's words are still only in English. */
export function englishOnly(pathname: string): boolean {
  return ENGLISH_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The person's pick when there is one, else what their browser asks for first, else English. */
export function pickLocale(saved: string | undefined | null, acceptLanguage: string | undefined | null): Locale {
  if (isLocale(saved)) return saved;
  const first = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().toLowerCase().split(";");
      const q = params.map((p) => /^q=([\d.]+)$/.exec(p.trim())?.[1]).find(Boolean);
      return { tag: tag ?? "", q: q === undefined ? 1 : Number(q) };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q)[0];
  return first?.tag.startsWith("es") ? "es" : "en";
}
