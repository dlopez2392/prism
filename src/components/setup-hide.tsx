"use client";

// src/components/setup-hide.tsx — Hide on the Getting started card: a cookie on this device, so the
// page itself leaves it out next time, and the page is drawn again now without it.

import { useRouter } from "next/navigation";
import { useT } from "@/components/locale";

/** The cookie Overview reads; a year, on this device only. */
export const SETUP_COOKIE = "prism-setup";

export function HideSetup() {
  const t = useT();
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-xs font-semibold text-accent-ink underline-offset-2 hover:underline"
      onClick={() => {
        document.cookie = `${SETUP_COOKIE}=hidden;path=/;max-age=31536000;samesite=lax`;
        router.refresh();
      }}
    >
      {t("Hide")}
    </button>
  );
}
