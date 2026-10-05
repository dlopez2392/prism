"use client";

// src/components/language-setting.tsx
//
// Language on the Account page: the same choice as EN | ES in the top bar
// (language-toggle.tsx), spelled out. Each choice is named in its own
// language, so someone who reads only that one can still find it. The pick is
// kept for this browser (lib/server/language-actions.ts) and the page renders
// again in it, at the same address. A radio pair, not buttons: it's a setting
// that is always one of two, and no primary action (DESIGN.md).

import { useOptimistic, useTransition } from "react";
import { Card, CardHeader } from "@/components/ui";
import { useLocale, useT } from "@/components/locale";
import { BRAND } from "@/lib/brand";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/lib/i18n/locale";
import { chooseLanguage } from "@/lib/server/language-actions";

export function LanguageSetting() {
  const t = useT();
  const current = useLocale();
  // The tapped choice shows as chosen at once; the page catches up when it renders again in it.
  const [shown, show] = useOptimistic(current);
  const [pending, start] = useTransition();

  function pick(locale: Locale) {
    if (locale === shown) return;
    start(async () => {
      show(locale);
      await chooseLanguage(locale);
    });
  }

  return (
    <Card id="language" className="scroll-mt-6 p-5 sm:p-6">
      {/* Both languages, as the top bar's switch is named: whoever reads either one finds it. */}
      <CardHeader title={<span id="language-title">Language · Idioma</span>} />
      <div role="radiogroup" aria-labelledby="language-title" aria-describedby="language-note" aria-busy={pending} className="mt-4 grid max-w-sm grid-cols-2 gap-2">
        {LOCALES.map((locale) => (
          <label key={locale} lang={locale} className="relative">
            <input type="radio" name="language" value={locale} checked={locale === shown} onChange={() => pick(locale)} className="peer sr-only" />
            <span className="flex min-h-11 cursor-pointer items-center justify-center rounded-ctl border border-line bg-surface-2 px-3 text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3 peer-checked:border-accent peer-checked:bg-accent-soft peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)]">
              {LOCALE_NAMES[locale]}
            </span>
          </label>
        ))}
      </div>
      <p id="language-note" className="mt-3 text-xs text-ink-3">
        {t("{product} shows its words in this language on this device. Dates follow it too; amounts stay in U.S. dollars as your bank writes them.", { product: BRAND.product })}
      </p>
    </Card>
  );
}
