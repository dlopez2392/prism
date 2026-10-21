"use client";

// src/components/business-sort.tsx
//
// The lines on the Business page, grouped by where they go on Schedule C, each
// with a choice of where else it could go (finance/schedule-c.ts). A choice
// takes effect at once; with "Every {shop}" ticked it moves every line from
// that shop going the same way, now and to come. The message, with its Undo,
// sits above the groups, so it stays on screen when the line moves to another.

import { useState, useTransition } from "react";
import clsx from "clsx";
import { ChevronRight, CircleCheck } from "lucide-react";
import { useT } from "@/components/locale";
import { Card } from "@/components/ui";
import { BIZ_LINES, type BizLine, type BizSide } from "@/lib/finance/details";
import { money, shortDate } from "@/lib/finance/format";
import { bizLineLabel } from "@/lib/finance/schedule-c";
import { sortBusinessLine } from "@/lib/server/details-actions";

export type BizRow = { id: string; merchant: string; date: string; amount: number; account: string | null; biz: BizLine; how: "you" | "shop" | "guess"; side: BizSide; own: BizLine | null; shop: BizLine | null };
export type BizGroup = { id: string; title: string; note?: string; total: number; rows: BizRow[] };
/** A heading over groups: money in, the costs, what isn't on the form. */
export type BizSection = { id: string; title: string; total?: number; groups: BizGroup[] };

type Message = { text: string; undo: { id: string; own: BizLine | null; shop: BizLine | null } | null; error?: true };

const field = "h-9 w-full rounded-ctl border border-line-strong bg-surface-2 px-2 text-[13px] font-semibold text-ink-1 focus:border-[var(--focus)] sm:w-64";

export function BusinessSort({ sections, canEdit }: { sections: BizSection[]; canEdit: boolean }) {
  const t = useT();
  const [message, setMessage] = useState<Message | null>(null);
  const [pending, start] = useTransition();

  const run = (id: string, sort: { own: BizLine | null; shop?: BizLine | null }, undo: Message["undo"]) =>
    start(async () => {
      const r = await sortBusinessLine(id, sort);
      setMessage(r.status === "saved" ? { text: r.message, undo } : { text: r.status === "error" ? r.message : "", undo: null, error: true });
    });
  const undoNow = () => {
    const u = message?.undo;
    if (u) run(u.id, { own: u.own, shop: u.shop }, null);
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
      {sections.map((sec) => (
        <section key={sec.id} aria-labelledby={`biz-${sec.id}`} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id={`biz-${sec.id}`} className="text-sm font-bold uppercase tracking-[0.08em] text-ink-3">
              {sec.title}
            </h2>
            {sec.total !== undefined ? <span className="num text-sm font-semibold text-ink-2">{money(sec.total)}</span> : null}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:gap-5 lg:grid-cols-2">
            {sec.groups.map((g) => (
              <Card as="article" key={g.id} className="p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-bold text-ink-1">{g.title}</h3>
                    <p className="text-xs text-ink-3">{g.rows.length === 1 ? t("1 transaction") : t("{n} transactions", { n: g.rows.length.toLocaleString("en-US") })}</p>
                  </div>
                  <div className="num shrink-0 text-xl font-extrabold tracking-tight text-ink-1">{money(g.total)}</div>
                </div>
                {g.note ? <p className="mt-2 text-sm text-ink-2">{g.note}</p> : null}
                <details className="group mt-3">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-accent-ink">
                    <ChevronRight aria-hidden className="size-3.5 transition-transform duration-150 group-open:rotate-90" />
                    {g.rows.length === 1 ? t("Show the transaction") : t("Show the {n} transactions", { n: g.rows.length })}
                  </summary>
                  <ul className="mt-2 max-h-[28rem] divide-y divide-line overflow-auto rounded-ctl bg-surface-2 px-3">
                    {g.rows.map((r) => (
                      <Row key={r.id} row={r} canEdit={canEdit} pending={pending} onSort={(sort) => run(r.id, sort, { id: r.id, own: r.own, shop: r.shop })} />
                    ))}
                  </ul>
                </details>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Row({ row: r, canEdit, pending, onSort }: { row: BizRow; canEdit: boolean; pending: boolean; onSort: (sort: { own: BizLine | null; shop?: BizLine | null }) => void }) {
  const t = useT();
  const [every, setEvery] = useState(true);
  const how = r.how === "guess" ? t("Prism's guess") : r.how === "shop" ? t("Every {merchant} goes here", { merchant: r.merchant }) : t("You put it here");
  return (
    <li className="py-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-ink-1 [overflow-wrap:anywhere]">{r.merchant}</div>
          <div className="text-xs text-ink-3">
            <span className="num">{shortDate(r.date, t.locale)}</span>
            {r.account ? ` · ${r.account}` : ""} · {how}
          </div>
        </div>
        <span className={clsx("num shrink-0 font-bold", r.amount > 0 ? "text-good-ink" : "text-ink-1")}>
          {r.amount > 0 ? "+" : ""}
          {money(r.amount)}
        </span>
      </div>
      {canEdit ? (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <select
            value={r.biz}
            disabled={pending}
            aria-label={t("Where {merchant} on {date} goes", { merchant: r.merchant, date: shortDate(r.date, t.locale) })}
            onChange={(e) => {
              const line = e.currentTarget.value as BizLine;
              onSort(every ? { own: null, shop: line } : { own: line });
            }}
            className={field}
          >
            {BIZ_LINES[r.side].map((id) => (
              <option key={id} value={id}>
                {bizLineLabel(id, t, r.side)}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={every} onChange={(e) => setEvery(e.currentTarget.checked)} className="size-4 shrink-0 accent-[var(--button)]" />
            {t("Every {merchant}", { merchant: r.merchant })}
          </label>
        </div>
      ) : null}
    </li>
  );
}
