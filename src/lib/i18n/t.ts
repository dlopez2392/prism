// src/lib/i18n/t.ts
//
// Words on screen, in the person's language. The English sentence is its own
// key: `t("Spent this month")` is that sentence in English, and its Spanish
// from es.ts in Spanish. A sentence not translated yet stays English rather
// than showing a key, and a test lists every one that's missing. Numbers and
// names go in by name: `t("Spent over {n} months", { n: 3 })`. A name
// written with a capital, `{Month}`, is the same value with its first letter
// in capitals, for a language that starts the sentence with what English
// puts in the middle ("{Month} hasta hoy" for "{month} to date").
//
// A translator also knows its language (`t.locale`), so whatever it's handed
// to can write a date the same way (finance/format.ts).
//
// Nothing here imports the Spanish itself: the browser is handed it by the
// root layout only when the page is in Spanish (components/locale.tsx), so a
// page in English never downloads it. Server code gets it from translator.ts.

import type { Locale } from "./locale";

export type Vars = Record<string, string | number>;
export type T = ((text: string, vars?: Vars) => string) & { readonly locale: Locale };
export type Messages = Readonly<Record<string, string>>;

export function translate(locale: Locale, messages: Messages | null): T {
  const fill = (vars: Vars) => (whole: string, name: string) => {
    if (Object.hasOwn(vars, name)) return String(vars[name]);
    const lower = name.charAt(0).toLowerCase() + name.slice(1);
    return lower !== name && Object.hasOwn(vars, lower) ? capital(String(vars[lower]), locale) : whole;
  };
  const t = (text: string, vars?: Vars) => {
    const s = messages && Object.hasOwn(messages, text) ? messages[text]! : text;
    return vars ? s.replace(/\{(\w+)\}/g, fill(vars)) : s;
  };
  return Object.assign(t, { locale });
}

function capital(s: string, locale: Locale): string {
  return s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
}

/** English, as written: the default wherever no language was asked for (emails, connected apps, tests). */
export const EN: T = translate("en", null);

/**
 * Marks a sentence for translation where it's written, to be translated where
 * it's shown: `label: msg("Overview")`, then `t(item.label)`. It changes
 * nothing; it's how the test finds the sentence to check its Spanish.
 */
export function msg<S extends string>(text: S): S {
  return text;
}
