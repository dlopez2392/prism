"use client";

// src/components/language-toggle.tsx
//
// EN | ES in the top bar, as bis-rgv.com has it. The pick is kept in a cookie
// by the server (lib/server/language-actions.ts) and the page renders again
// in it, at the same address. Each choice is named in its own language, so
// someone who reads only that one can still find it.

import { useTransition } from "react";
import clsx from "clsx";
import { LOCALE_NAMES, LOCALES } from "@/lib/i18n/locale";
import { useLocale } from "@/components/locale";
import { chooseLanguage } from "@/lib/server/language-actions";

export function LanguageToggle() {
  const current = useLocale();
  const [pending, start] = useTransition();
  return (
    <div role="group" aria-label="Language · Idioma" className="flex items-center text-xs font-bold">
      {LOCALES.map((locale, i) => (
        <span key={locale} className="flex items-center">
          {i > 0 ? (
            <span aria-hidden className="px-0.5 text-ink-3">
              |
            </span>
          ) : null}
          <button
            type="button"
            lang={locale}
            aria-label={LOCALE_NAMES[locale]}
            aria-pressed={locale === current}
            disabled={pending}
            onClick={() => locale !== current && start(() => chooseLanguage(locale))}
            className={clsx(
              "grid h-8 min-w-8 place-items-center rounded-ctl px-1.5 transition-colors duration-150 disabled:opacity-60",
              locale === current ? "text-ink-1" : "text-ink-3 hover:text-ink-1",
            )}
          >
            {locale.toUpperCase()}
          </button>
        </span>
      ))}
    </div>
  );
}
