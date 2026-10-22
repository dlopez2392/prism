"use client";

// src/components/tax-returns.tsx
//
// The returns on Taxes (finance/tax-return.ts): each one's figures as the page
// worked them out, and a way to remove one. Removing takes effect at once,
// with an Undo beside the message, which sits above the cards so it stays on
// screen when the card it was about is gone.

import { useState, useTransition } from "react";
import Link from "next/link";
import clsx from "clsx";
import { CircleCheck, FileText } from "lucide-react";
import { buttonGhost, buttonSmall } from "@/components/dialog";
import { useT } from "@/components/locale";
import { Card } from "@/components/ui";
import type { TaxReturn } from "@/lib/finance/tax-return";
import { removeTaxReturn, saveTaxReturn } from "@/lib/server/return-actions";

export type ReturnCard = { year: number; title: string; subtitle: string; figures: { label: string; value: string }[]; notes: string[] };

export function TaxReturns({ cards, add, canEdit }: { cards: ReturnCard[]; add: { year: number; title: string; body: string } | null; canEdit: boolean }) {
  const t = useT();
  const [message, setMessage] = useState<{ text: string; undo: TaxReturn | null; error?: true } | null>(null);
  const [pending, start] = useTransition();
  const remove = (year: number) =>
    start(async () => {
      const r = await removeTaxReturn(year);
      setMessage(r.status === "saved" ? { text: r.message, undo: r.undo ?? null } : { text: r.message, undo: null, error: true });
    });
  const undo = () => {
    const back = message?.undo;
    if (!back) return;
    start(async () => {
      const r = await saveTaxReturn(back);
      setMessage(r.status === "saved" ? { text: t("Put back."), undo: null } : { text: r.message, undo: null, error: true });
    });
  };

  return (
    <div className="space-y-3">
      <p role="status" className={clsx("min-h-5 text-xs font-semibold", !message && "sr-only")}>
        {message ? (
          <span className={message.error ? "text-crit-ink" : "inline-flex flex-wrap items-center gap-1 text-good-ink"}>
            {message.error ? null : <CircleCheck aria-hidden className="size-3.5 shrink-0" />}
            {message.text}
            {message.undo ? (
              <button type="button" onClick={undo} disabled={pending} className="ml-2 font-semibold text-accent-ink underline-offset-2 hover:underline">
                {t("Undo")}
              </button>
            ) : null}
          </span>
        ) : null}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:gap-5 lg:grid-cols-2">
        {cards.map((c) => (
          <Card as="article" key={c.year} className="p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[15px] font-bold text-ink-1">{c.title}</h3>
                <p className="text-xs text-ink-3">{c.subtitle}</p>
              </div>
              {canEdit ? (
                <button type="button" className={buttonSmall} disabled={pending} onClick={() => remove(c.year)} aria-label={t("Remove your {year} return", { year: c.year })}>
                  {t("Remove")}
                </button>
              ) : null}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
              {c.figures.map((f) => (
                <div key={f.label}>
                  <dt className="text-xs font-semibold text-ink-3">{f.label}</dt>
                  <dd className="num text-lg font-extrabold tracking-tight text-ink-1">{f.value}</dd>
                </div>
              ))}
            </dl>
            {c.notes.map((n) => (
              <p key={n} className="mt-3 text-sm text-ink-2">
                {n}
              </p>
            ))}
          </Card>
        ))}
        {add ? (
          <Card as="article" className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <FileText aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-3" />
              <div className="min-w-0">
                <h3 className="text-[15px] font-bold text-ink-1">{add.title}</h3>
                <p className="mt-1 text-sm text-ink-2">{add.body}</p>
                <Link href="/taxes/return" className={clsx(buttonGhost, "mt-3")}>
                  {t("Add your return")}
                </Link>
              </div>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
