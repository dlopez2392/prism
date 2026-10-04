"use client";

// src/components/split-rules.tsx
//
// The shops whose every purchase the person splits the same way, on
// Spending: each with its shares, and a Remove that takes effect at once with
// an Undo beside the message (setSplitRule), so a slip costs one tap.

import { useState, useTransition } from "react";
import { CircleCheck } from "lucide-react";
import { buttonSmall } from "@/components/dialog";
import { CATEGORIES } from "@/lib/finance/categories";
import type { SplitRule } from "@/lib/finance/details";
import { setSplitRule } from "@/lib/server/details-actions";

export type SplitRuleRow = { key: string } & SplitRule;

const percent = (share: number) => `${Number((share / 100).toFixed(2))}%`;

export function SplitRules({ rules }: { rules: SplitRuleRow[] }) {
  const [message, setMessage] = useState<{ text: string; undo: SplitRuleRow | null; error?: true } | null>(null);
  const [pending, start] = useTransition();

  const set = (row: SplitRuleRow, remove: boolean) =>
    start(async () => {
      const r = await setSplitRule(row.key, remove ? null : { name: row.name, split: row.split });
      setMessage(r.status === "saved" ? { text: r.message, undo: remove ? row : null } : { text: r.status === "error" ? r.message : "", undo: null, error: true });
    });

  return (
    <div>
      <p role="status" className="min-h-5 text-xs font-semibold">
        {message ? (
          <span className={message.error ? "text-crit-ink" : "inline-flex items-center gap-1 text-good-ink"}>
            {message.error ? null : <CircleCheck aria-hidden className="size-3.5 shrink-0" />}
            {message.text}
            {message.undo ? (
              <button type="button" onClick={() => set(message.undo!, false)} disabled={pending} className="ml-2 font-semibold text-accent-ink underline-offset-2 hover:underline">
                Undo
              </button>
            ) : null}
          </span>
        ) : null}
      </p>
      <ul className="mt-1 divide-y divide-[var(--line)]">
        {rules.map((r) => (
          <li key={r.key} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink-1 [overflow-wrap:anywhere]">Every {r.name} purchase</div>
              <div className="num text-xs text-ink-3">{r.split.map((p) => `${CATEGORIES[p.category].label} ${percent(p.share)}`).join(" · ")}</div>
            </div>
            <button type="button" onClick={() => set(r, true)} disabled={pending} className={buttonSmall} aria-label={`Stop splitting ${r.name} purchases`}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
