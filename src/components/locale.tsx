"use client";

// src/components/locale.tsx — the page's language, handed down from the root
// layout so client components say the same words the server did. The layout
// hands over the Spanish only when the page is in Spanish (lib/i18n/t.ts).

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { englishOnly, type Locale } from "@/lib/i18n/locale";
import { EN, translate, type Messages, type T } from "@/lib/i18n/t";

const LocaleContext = createContext<T>(EN);

export function LocaleProvider({ locale, messages, children }: { locale: Locale; messages: Messages | null; children: ReactNode }) {
  const t = useMemo(() => translate(locale, messages), [locale, messages]);
  return <LocaleContext.Provider value={t}>{children}</LocaleContext.Provider>;
}

export function useT(): T {
  return useContext(LocaleContext);
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

/** A screen's content, marked English while the page is in Spanish but this screen's words aren't yet (locale.ts ENGLISH_ONLY). */
export function ScreenLanguage({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const pathname = usePathname();
  const english = locale !== "en" && englishOnly(pathname);
  return <div lang={english ? "en" : undefined}>{children}</div>;
}
