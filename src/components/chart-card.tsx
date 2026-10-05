"use client";

// src/components/chart-card.tsx
//
// A card that holds one chart and its table twin. The tooltip enhances; the
// table guarantees — every value on the chart is reachable without hovering
// (DESIGN.md §Charts).

import { useState, type ReactNode } from "react";
import { ChartColumn, Table2 } from "lucide-react";
import clsx from "clsx";
import { useT } from "@/components/locale";

export type TableData = { columns: string[]; rows: (string | number)[][]; caption: string };

export function ChartCard({
  title,
  subtitle,
  legend,
  action,
  table,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  legend?: ReactNode;
  action?: ReactNode;
  table?: TableData;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const t = useT();
  return (
    <section className={clsx("fade-up rounded-card border border-line bg-surface-1 p-4 shadow-card sm:p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold tracking-tight text-ink-1">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {table ? (
            <button
              type="button"
              onClick={() => setAsTable((v) => !v)}
              aria-pressed={asTable}
              className="inline-flex h-8 items-center gap-1.5 rounded-ctl border border-line px-2.5 text-xs font-semibold text-ink-2 transition-colors duration-150 hover:bg-surface-3 print:hidden"
            >
              {asTable ? <ChartColumn aria-hidden className="size-3.5" /> : <Table2 aria-hidden className="size-3.5" />}
              {asTable ? t("Chart") : t("Table")}
            </button>
          ) : null}
        </div>
      </div>
      {legend && !asTable ? <div className="mt-3">{legend}</div> : null}
      <div className={clsx("mt-4", bodyClassName)}>
        {asTable && table ? (
          <div className="max-h-96 overflow-auto rounded-ctl border border-line">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{table.caption}</caption>
              <thead className="sticky top-0 bg-surface-2 text-[11px] uppercase tracking-wider text-ink-3">
                <tr>
                  {table.columns.map((c, i) => (
                    <th key={c} scope="col" className={clsx("px-3 py-2 font-semibold", i > 0 && "text-right")}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    {r.map((cell, j) =>
                      j === 0 ? (
                        <th key={j} scope="row" className="px-3 py-2 font-medium text-ink-1">
                          {cell}
                        </th>
                      ) : (
                        <td key={j} className="num px-3 py-2 text-right text-ink-2">
                          {cell}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
