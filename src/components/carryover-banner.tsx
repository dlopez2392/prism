"use client";

// src/components/carryover-banner.tsx
//
// Signed in, with things still on this device from before: offer to move
// them into the account. Nothing moves until the person says so.

import { useTransition } from "react";
import { MonitorSmartphone } from "lucide-react";
import { buttonGhost, buttonPrimary } from "@/components/dialog";
import { carryoverLater, moveDeviceToAccount } from "@/lib/server/carryover-actions";
import type { Carryover } from "@/lib/server/finance";
import { useT } from "@/components/locale";
import type { T } from "@/lib/i18n/t";

function list(items: string[], t: T): string {
  if (items.length <= 1) return items[0] ?? "";
  return t("{list} and {last}", { list: items.slice(0, -1).join(", "), last: items.at(-1)! });
}

export function CarryoverBanner({ items }: { items: Carryover[] }) {
  const [pending, start] = useTransition();
  const t = useT();
  const named = list(
    items.map((i) => t(i.text, i.n === undefined ? undefined : { n: i.n })),
    t,
  );
  // "Add it" for one bank or Coinbase; "them" for several, or for budgets and goals (plural words).
  const one = items.length === 1 && !items[0]!.text.startsWith("your") && items[0]!.n === undefined;
  return (
    <div role="region" aria-label={t("Move this device's data")} className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-ctl border border-line bg-surface-1 px-4 py-3 sm:mx-6 lg:mx-8">
      <MonitorSmartphone aria-hidden className="size-5 shrink-0 text-accent" />
      <p className="min-w-0 flex-1 text-sm text-ink-1">
        {one
          ? t("This browser still holds {items} from before you signed in. Add it to your account?", { items: named })
          : t("This browser still holds {items} from before you signed in. Add them to your account?", { items: named })}
      </p>
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={() => start(() => carryoverLater())} className={`${buttonGhost} h-9`}>
          {t("Not now")}
        </button>
        <button type="button" disabled={pending} onClick={() => start(() => moveDeviceToAccount())} className={`${buttonPrimary} h-9`}>
          {pending ? t("Moving…") : t("Add to my account")}
        </button>
      </div>
    </div>
  );
}
