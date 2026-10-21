"use client";

// src/components/fee-request.tsx
//
// "Ask for it back" on the Fees page: the request is already written (in
// finance/fees.ts, in the page's language); this shows it, and copies it or
// hands it to the phone's share sheet. Prism never sends it: the person sends
// it to their bank themselves, the way they reach it.

import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { buttonSmall } from "@/components/dialog";
import { useT } from "@/components/locale";

export function FeeRequest({ text, label }: { text: string; label: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <div className="w-full">
      <button type="button" className={buttonSmall} aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={label}>
        {t("Ask for it back")}
      </button>
      {open ? (
        <div className="mt-2 rounded-ctl bg-surface-2 p-3">
          <p className="text-sm text-ink-1">{text}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonSmall}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(text);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
              {copied ? t("Copied") : t("Copy")}
            </button>
            {canShare ? (
              <button type="button" className={buttonSmall} onClick={() => navigator.share({ text }).catch(() => undefined)}>
                <Share2 aria-hidden className="size-3.5" />
                {t("Share")}
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-ink-3">{t("Send it through your bank's app, its secure messages, or read it on the phone. Prism never sends it for you.")}</p>
          <span role="status" className="sr-only">
            {copied ? t("Copied") : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}
