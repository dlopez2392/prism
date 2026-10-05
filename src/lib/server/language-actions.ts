"use server";

// src/lib/server/language-actions.ts
//
// The EN | ES toggle: the language Prism speaks to this browser, kept in a
// cookie for a year (lib/i18n/locale.ts) and read on every request. Anything
// but a language Prism has is ignored, so the cookie only ever holds "en" or
// "es". Setting a cookie here re-renders the page in the same response.

import { cookies } from "next/headers";
import { LANG_COOKIE, LOCALES, type Locale } from "@/lib/i18n/locale";

export async function chooseLanguage(locale: unknown): Promise<void> {
  if (!LOCALES.includes(locale as Locale)) return;
  (await cookies()).set(LANG_COOKIE, locale as Locale, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
