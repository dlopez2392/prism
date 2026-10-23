// src/components/change-notice.tsx
//
// A change to the Terms or the privacy policy that matters, told before it
// takes effect (legal-notice.ts): a bar under the header for everyone signed
// in, until they choose Got it on this device.

import Link from "next/link";
import { Megaphone } from "lucide-react";
import { buttonGhost } from "@/components/dialog";
import { inEffect, noticeWords, type ChangeNotice } from "@/lib/legal-notice";
import type { ISODate } from "@/lib/finance/types";
import type { T } from "@/lib/i18n/t";
import { dismissNotice } from "@/lib/server/notice-actions";

export function ChangeNoticeBar({ notice, today, t }: { notice: ChangeNotice; today: ISODate; t: T }) {
  const { title, points } = noticeWords(notice, t);
  return (
    <section aria-labelledby="change-notice" className="mx-4 mt-4 rounded-card border border-line bg-surface-1 px-4 py-4 sm:mx-6 sm:px-5 lg:mx-8 print:hidden">
      <div className="flex items-start gap-3">
        <Megaphone aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-ink" />
        <div className="min-w-0 flex-1">
          <h2 id="change-notice" className="text-sm font-bold text-ink-1">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-ink-3">{inEffect(notice, today) ? t("This change has taken effect.") : t("Here's what changes, before it does.")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-ink-2">
            {points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <form action={dismissNotice}>
              <input type="hidden" name="notice" value={notice.id} />
              <button type="submit" className={buttonGhost}>
                {t("Got it")}
              </button>
            </form>
            <Link href="/terms" className="text-sm font-semibold text-accent-ink underline-offset-2 hover:underline">
              {t("Read the Terms of Service")}
            </Link>
            <Link href="/pricing" className="text-sm font-semibold text-accent-ink underline-offset-2 hover:underline">
              {t("See what each plan includes")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
