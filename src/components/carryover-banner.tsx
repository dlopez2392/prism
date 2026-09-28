"use client";

// src/components/carryover-banner.tsx
//
// Signed in, with things still on this device from before: offer to move
// them into the account. Nothing moves until the person says so.

import { useTransition } from "react";
import { MonitorSmartphone } from "lucide-react";
import { buttonGhost, buttonPrimary } from "@/components/dialog";
import { carryoverLater, moveDeviceToAccount } from "@/lib/server/carryover-actions";

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function CarryoverBanner({ items }: { items: string[] }) {
  const [pending, start] = useTransition();
  return (
    <div role="region" aria-label="Move this device's data" className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-ctl border border-line bg-surface-1 px-4 py-3 sm:mx-6 lg:mx-8">
      <MonitorSmartphone aria-hidden className="size-5 shrink-0 text-accent" />
      <p className="min-w-0 flex-1 text-sm text-ink-1">
        This browser still holds {list(items)} from before you signed in. Add {items.length === 1 && !items[0]!.startsWith("your") ? "it" : "them"} to your account?
      </p>
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={() => start(() => carryoverLater())} className={`${buttonGhost} h-9`}>
          Not now
        </button>
        <button type="button" disabled={pending} onClick={() => start(() => moveDeviceToAccount())} className={`${buttonPrimary} h-9`}>
          {pending ? "Moving…" : "Add to my account"}
        </button>
      </div>
    </div>
  );
}
