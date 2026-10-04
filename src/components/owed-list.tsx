"use client";

// src/components/owed-list.tsx
//
// Who owes the person, still open, on Spending: each with the purchase it's
// for and a "Paid back" that takes it off the list at once, with an Undo
// beside the message, so a slip costs one tap (markOwedPaid). "Remind" writes
// a friendly nudge and hands it to the phone's share sheet (a text, a chat,
// a payment app), or copies it where there's none. Prism sends nothing itself.

import { useState, useTransition } from "react";
import { CircleCheck } from "lucide-react";
import { reminderText } from "@/lib/finance/details";
import { buttonSmall } from "@/components/dialog";
import { money, shortDate } from "@/lib/finance/format";
import { markOwedPaid } from "@/lib/server/details-actions";

export type OwedRow = { id: string; who: string; amount: number; merchant: string; date: string };

export function OwedList({ rows }: { rows: OwedRow[] }) {
  const [message, setMessage] = useState<{ text: string; undo: string | null; error?: true } | null>(null);
  const [pending, start] = useTransition();

  const remind = async (r: OwedRow) => {
    const text = reminderText(r);
    try {
      if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare({ text }))) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setMessage({ text: `Copied a reminder for ${r.who}. Paste it into a text or a chat.`, undo: null });
    } catch (e) {
      // Closing the share sheet isn't a failure.
      if (e instanceof Error && e.name === "AbortError") return;
      setMessage({ text: `Couldn't copy it. Here it is: ${text}`, undo: null, error: true });
    }
  };

  const mark = (id: string, paid: boolean) =>
    start(async () => {
      const r = await markOwedPaid(id, paid);
      setMessage(r.status === "saved" ? { text: r.message, undo: paid ? id : null } : { text: r.status === "error" ? r.message : "", undo: null, error: true });
    });

  return (
    <div>
      <p role="status" className="min-h-5 text-xs font-semibold">
        {message ? (
          <span className={message.error ? "text-crit-ink" : "inline-flex items-center gap-1 text-good-ink"}>
            {message.error ? null : <CircleCheck aria-hidden className="size-3.5 shrink-0" />}
            {message.text}
            {message.undo ? (
              <button type="button" onClick={() => mark(message.undo!, false)} disabled={pending} className="ml-2 font-semibold text-accent-ink underline-offset-2 hover:underline">
                Undo
              </button>
            ) : null}
          </span>
        ) : null}
      </p>
      <ul className="mt-1 divide-y divide-[var(--line)]">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink-1">
                {r.who} owes you <span className="num">{money(r.amount)}</span>
              </div>
              <div className="text-xs text-ink-3">
                {r.merchant} · <span className="num">{shortDate(r.date)}</span>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => void remind(r)} className={buttonSmall} aria-label={`Remind ${r.who} about ${money(r.amount)} for ${r.merchant}`}>
                Remind
              </button>
              <button type="button" onClick={() => mark(r.id, true)} disabled={pending} className={buttonSmall} aria-label={`${r.who} paid you back ${money(r.amount)} for ${r.merchant}`}>
                Paid back
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
