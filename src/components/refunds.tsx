"use client";

// src/components/refunds.tsx
//
// The lists on the Refunds page, and what a person can do from them: say
// they're waiting on money that may be owed (a fee, a charge twice, one after
// cancelling), say a refund came back another way, or stop waiting on one.
// Every change takes effect at once, with an Undo beside the message, which
// sits above the lists so it stays on screen when the row it was about moves
// to another list (refund-actions.ts). Prism never asks anyone for money: it
// only keeps track.

import { useState, useTransition } from "react";
import { CircleCheck, Clock, Undo2 } from "lucide-react";
import clsx from "clsx";
import { buttonSmall } from "@/components/dialog";
import { useT } from "@/components/locale";
import { Card, CardHeader, StatusPill } from "@/components/ui";
import type { RefundKind, RefundMark } from "@/lib/finance/details";
import { money, shortDate } from "@/lib/finance/format";
import type { CameBack, MayBeOwed, Waiting } from "@/lib/finance/refunds";
import { msg, type T } from "@/lib/i18n/t";
import { putRefund, refundCameBack, stopWaiting, waitForRefund, type RefundState } from "@/lib/server/refund-actions";

/** Why each one is due back, as a row says it (translated where shown). */
export const REFUND_LABELS: Record<RefundKind, string> = {
  return: msg("Return"),
  fee: msg("Fee asked back"),
  double: msg("Charged twice"),
  "after-cancel": msg("Charged after cancelling"),
  other: msg("Refund"),
};

type Message = { text: string; undo: { id: string; mark: RefundMark | null } | null; error?: true };

function waitingNote(w: Waiting, t: T): string {
  return w.late > 0
    ? w.late === 1
      ? t("1 day late. Waiting since {date}", { date: shortDate(w.asked, t.locale) })
      : t("{n} days late. Waiting since {date}", { n: w.late, date: shortDate(w.asked, t.locale) })
    : t("Usually back by {date}", { date: shortDate(w.due, t.locale) });
}

export function RefundsBoard({
  waiting,
  suggestions,
  back,
  accounts,
  canEdit,
}: {
  waiting: Waiting[];
  suggestions: MayBeOwed[];
  back: CameBack[];
  /** Each account's name as a row shows it, by id. */
  accounts: Record<string, string>;
  /** A signed-in person's own money: the example household can't be changed. */
  canEdit: boolean;
}) {
  const t = useT();
  const [message, setMessage] = useState<Message | null>(null);
  const [pending, start] = useTransition();

  const run = (id: string, act: () => Promise<RefundState>) =>
    start(async () => {
      const r = await act();
      setMessage(r.status === "saved" ? { text: r.message, undo: r.undo !== undefined ? { id, mark: r.undo } : null } : { text: r.status === "error" ? r.message : "", undo: null, error: true });
    });
  const undoNow = () => {
    const undo = message?.undo;
    if (undo) run(undo.id, () => putRefund(undo.id, undo.mark));
  };

  return (
    <div className="space-y-5">
      <p role="status" className={clsx("min-h-5 text-xs font-semibold", !message && "sr-only")}>
        {message ? (
          <span className={message.error ? "text-crit-ink" : "inline-flex flex-wrap items-center gap-1 text-good-ink"}>
            {message.error ? null : <CircleCheck aria-hidden className="size-3.5 shrink-0" />}
            {message.text}
            {message.undo ? (
              <button type="button" onClick={undoNow} disabled={pending} className="ml-2 font-semibold text-accent-ink underline-offset-2 hover:underline">
                {t("Undo")}
              </button>
            ) : null}
          </span>
        ) : null}
      </p>

      <Card className="p-5 sm:p-6">
        <CardHeader title={t("Waiting on")} subtitle={t("Late ones first. Prism spots each one when the money comes in, from the same shop or as a refund in the same account.")} />
        {waiting.length ? (
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {waiting.map((w) => (
              <li key={w.id} className="py-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-ink-1 [overflow-wrap:anywhere]">{w.name}</div>
                    <div className="text-xs text-ink-3">
                      {t(REFUND_LABELS[w.kind])} · {w.kind === "return" || w.kind === "other" ? t("bought {date}", { date: shortDate(w.date, t.locale) }) : t("charged {date}", { date: shortDate(w.date, t.locale) })}
                    </div>
                  </div>
                  <div className="num shrink-0 text-sm font-bold text-ink-1">{money(w.amount)}</div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {w.late > 0 ? <StatusPill status="warn">{waitingNote(w, t)}</StatusPill> : <span className="inline-flex items-center gap-1 text-xs text-ink-3"><Clock aria-hidden className="size-3.5" />{waitingNote(w, t)}</span>}
                  {canEdit ? (
                    <span className="ml-auto flex gap-2">
                      <button type="button" onClick={() => run(w.id, () => refundCameBack(w.id, true))} disabled={pending} className={buttonSmall} aria-label={t("The {amount} from {name} came back", { amount: money(w.amount), name: w.name })}>
                        {t("It came back")}
                      </button>
                      <button type="button" onClick={() => run(w.id, () => stopWaiting(w.id))} disabled={pending} className={buttonSmall} aria-label={t("Stop waiting on {amount} from {name}", { amount: money(w.amount), name: w.name })}>
                        {t("Stop waiting")}
                      </button>
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink-2">{t("Nothing yet. Returned something, or asked for a fee back? Open the purchase in your transactions and choose Waiting on a refund.")}</p>
        )}
      </Card>

      {suggestions.length ? (
        <Card className="p-5 sm:p-6">
          <CardHeader title={t("You might be owed")} subtitle={t("From the last 60 days. If you ask for one back, say so here and Prism watches for it.")} />
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {suggestions.map((s) => (
              <li key={s.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink-1 [overflow-wrap:anywhere]">{s.name}</div>
                  <div className="text-xs text-ink-3">
                    {t(REFUND_LABELS[s.kind])} · {shortDate(s.date, t.locale)}
                    {accounts[s.accountId] ? ` · ${accounts[s.accountId]}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="num text-sm font-bold text-ink-1">{money(s.amount)}</span>
                  {canEdit ? (
                    <button type="button" onClick={() => run(s.id, () => waitForRefund(s.id, s.amount, s.kind))} disabled={pending} className={buttonSmall} aria-label={t("I asked for the {amount} from {name} back", { amount: money(s.amount), name: s.name })}>
                      {t("I asked for it back")}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {back.length ? (
        <Card className="p-5 sm:p-6">
          <CardHeader title={t("Came back")} subtitle={t("The last 12 months, the latest first.")} />
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {back.map((b) => (
              <li key={b.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink-1 [overflow-wrap:anywhere]">{b.name}</div>
                  <div className="text-xs text-ink-3">
                    {t(REFUND_LABELS[b.kind])} · {b.via ? t("came back {date}", { date: shortDate(b.on, t.locale) }) : t("you said it came back {date}", { date: shortDate(b.on, t.locale) })}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusPill status="good">{money(b.amount)}</StatusPill>
                  {canEdit && !b.via ? (
                    <button type="button" onClick={() => run(b.id, () => refundCameBack(b.id, false))} disabled={pending} className={buttonSmall} aria-label={t("The {amount} from {name} hasn't come back", { amount: money(b.amount), name: b.name })}>
                      <Undo2 aria-hidden className="size-3.5" />
                      {t("Not back yet")}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
