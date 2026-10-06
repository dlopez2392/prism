// src/lib/i18n/translator.ts — a translator for a language, with its words
// loaded here. For the server, jobs and tests; a browser gets its words from
// the root layout instead (t.ts).

import { ES } from "./es";
import type { Locale } from "./locale";
import { translate, type Messages, type T } from "./t";

export function messagesFor(locale: Locale): Messages | null {
  return locale === "es" ? ES : null;
}

export function translator(locale: Locale): T {
  return translate(locale, messagesFor(locale));
}
