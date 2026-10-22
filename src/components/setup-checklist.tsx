// src/components/setup-checklist.tsx
//
// Getting started, on Overview (finance/setup.ts): the steps that make Prism
// useful in the first week, each a link to where it's done and a status in
// words, the counted ones measured. It leaves on its own once every counted
// step is done, and Hide puts it away sooner, on this device.

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { HideSetup } from "@/components/setup-hide";
import { Card, CardHeader, Meter, StatusPill } from "@/components/ui";
import type { SetupStep } from "@/lib/finance/setup";
import type { T } from "@/lib/i18n/t";

function Step({ s, t }: { s: SetupStep; t: T }) {
  return (
    <li>
      <Link href={s.href} className="flex items-start gap-3 rounded-ctl px-2 py-2.5 transition-colors duration-150 hover:bg-surface-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink-1">{t(s.title)}</div>
          <div className="text-xs text-ink-3">{t(s.detail)}</div>
        </div>
        {s.done ? (
          <StatusPill status="good" className="shrink-0">
            {t("Done")}
          </StatusPill>
        ) : (
          <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
        )}
      </Link>
    </li>
  );
}

export function SetupChecklist({ steps, t }: { steps: SetupStep[]; t: T }) {
  const core = steps.filter((s) => s.core);
  const done = core.filter((s) => s.done).length;
  const some = steps.filter((s) => !s.core && !s.done);
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader title={t("Getting started")} subtitle={t("{done} of {n} done", { done, n: core.length })} action={<HideSetup t={t} />} />
      <div className="mt-3">
        <Meter ratio={done / core.length} color="var(--accent)" label={t("{done} of {n} done", { done, n: core.length })} />
      </div>
      <ul className="mt-3 -mx-2 divide-y divide-[var(--line)]">
        {core.map((s) => (
          <Step key={s.id} s={s} t={t} />
        ))}
      </ul>
      {some.length ? (
        <>
          <h3 className="mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">{t("If it applies to you")}</h3>
          <ul className="mt-1 -mx-2 divide-y divide-[var(--line)]">
            {some.map((s) => (
              <Step key={s.id} s={s} t={t} />
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}
