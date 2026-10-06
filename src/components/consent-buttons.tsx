"use client";

// src/components/consent-buttons.tsx — Allow / Don't allow, saying so while the choice is on its way.

import { useFormStatus } from "react-dom";
import { buttonGhost, buttonPrimary } from "@/components/dialog";
import { useT } from "@/components/locale";

/** `appName` is null when the app's name is too long for a button: it says "Allow it" then. */
export function ConsentButtons({ appName }: { appName: string | null }) {
  const t = useT();
  const { pending, data } = useFormStatus();
  const choosing = pending ? data?.get("decision") : null;
  return (
    <div className="mt-6 grid gap-2 sm:grid-cols-2">
      {/* The primary button comes first, so Enter allows — the page is here because the person asked to connect. */}
      <button type="submit" name="decision" value="allow" disabled={pending} className={`${buttonPrimary} sm:order-2`}>
        {choosing === "allow" ? t("Connecting…") : appName ? t("Allow {name}", { name: appName }) : t("Allow it")}
      </button>
      <button type="submit" name="decision" value="deny" disabled={pending} className={`${buttonGhost} sm:order-1`}>
        {choosing === "deny" ? t("Saying no…") : t("Don't allow")}
      </button>
    </div>
  );
}
