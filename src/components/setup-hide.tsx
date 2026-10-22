// src/components/setup-hide.tsx — Hide on the Getting started card: a form whose action sets the
// cookie Overview reads (server/setup-actions.ts), so it works before the page has come alive too.

import { hideSetup } from "@/lib/server/setup-actions";
import type { T } from "@/lib/i18n/t";

export function HideSetup({ t }: { t: T }) {
  return (
    <form action={hideSetup}>
      <button type="submit" className="text-xs font-semibold text-accent-ink underline-offset-2 hover:underline">
        {t("Hide")}
      </button>
    </form>
  );
}
