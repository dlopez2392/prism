// src/lib/i18n/locale.ts
//
// Which language Prism speaks: English or Spanish. A person picks with the
// EN | ES switch in the top bar (the same switch bis-rgv.com has); the choice
// is kept in a cookie, so every page renders in it from the server, with no
// flash and the same addresses in both. Until they pick, a browser that asks
// for Spanish first gets Spanish.

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

/** The cookie that keeps the choice, on this device, for a year. */
export const LANG_COOKIE = "prism-lang";

export const LOCALE_NAMES: Record<Locale, string> = { en: "English", es: "Español" };

/**
 * The screens whose words are still only in English (docs/ROADMAP.md, item
 * 29). In Spanish, their content is marked English (components/locale.tsx),
 * so a screen reader reads it in an English voice. Each comes off this list
 * when its Spanish is done, and the list goes when it's empty.
 */
export const ENGLISH_ONLY = ["/connections", "/account", "/household", "/oauth", "/alerts", "/privacy", "/terms"];

/** Whether a screen's words are still only in English. */
export function englishOnly(pathname: string): boolean {
  return ENGLISH_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The person's pick when there is one, else what their browser asks for first, else English. */
export function pickLocale(saved: string | undefined | null, acceptLanguage: string | undefined | null): Locale {
  if (saved === "en" || saved === "es") return saved;
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
