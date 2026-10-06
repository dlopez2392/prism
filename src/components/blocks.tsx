// src/components/blocks.tsx
//
// Composite, server-rendered pieces shared by several screens: stat tiles,
// insight cards (with their evidence one tap away), transaction rows and the
// upcoming-bills list.

import Link from "next/link";
import { ChevronRight, Lightbulb, PartyPopper, TriangleAlert, type LucideIcon } from "lucide-react";
import clsx from "clsx";
import type { ReactNode } from "react";
import { Sparkline } from "@/components/charts/sparkline";
import { CategoryIcon } from "@/components/category-icon";
import { Card } from "@/components/ui";
import { categoryLabel } from "@/lib/finance/categories";
import { dayDate, money, shortDate } from "@/lib/finance/format";
import type { Alert } from "@/lib/finance/alerts";
import type { ForecastEvent } from "@/lib/finance/forecast";
import type { Insight } from "@/lib/finance/insights";
import type { Transaction } from "@/lib/finance/types";
import { EN, msg, type T } from "@/lib/i18n/t";

export function StatTile({
  label,
  value,
  change,
  spark,
  sparkColor,
  foot,
}: {
  label: string;
  value: string;
  change?: ReactNode;
  spark?: number[];
  sparkColor?: string;
  foot?: ReactNode;
}) {
  return (
    <Card className="flex flex-col justify-between gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] font-semibold text-ink-2">{label}</div>
        {spark && spark.length > 1 ? <Sparkline values={spark} color={sparkColor} width={72} height={28} /> : null}
      </div>
      <div>
        <div className="text-[26px] font-extrabold leading-none tracking-tight text-ink-1">{value}</div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
          {change}
          {foot}
        </div>
      </div>
    </Card>
  );
}

const TONE: Record<Insight["tone"], { icon: LucideIcon; label: string; chip: string }> = {
  heads_up: { icon: TriangleAlert, label: msg("Heads up"), chip: "text-warn" },
  win: { icon: PartyPopper, label: msg("Nice"), chip: "text-good" },
  idea: { icon: Lightbulb, label: msg("Worth knowing"), chip: "text-accent" },
};

/**
 * Insights with their working shown: every card opens to the exact
 * transactions it was computed from (DESIGN.md rule 7). Native <details>, so
 * it works before any JavaScript arrives.
 */
export function InsightList({ insights, lookup, limit = 4, t = EN }: { insights: Insight[]; lookup: Map<string, Transaction>; limit?: number; t?: T }) {
  return (
    <ul className="space-y-3">
      {insights.slice(0, limit).map((i) => {
        const tone = TONE[i.tone];
        const Icon = tone.icon;
        const evidence = i.evidence.map((id) => lookup.get(id)).filter((x): x is Transaction => Boolean(x));
        return (
          <li key={i.id} className="rounded-ctl border border-line bg-surface-2 p-3.5">
            <div className="flex gap-3">
              <div className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-1">
                <Icon aria-hidden className={clsx("size-4", tone.chip)} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-3">{t(tone.label)}</div>
                <div className="mt-0.5 text-sm font-bold text-ink-1">{i.title}</div>
                <p className="mt-1 text-[13px] text-ink-2">{i.detail}</p>
                {evidence.length ? (
                  <details className="group mt-2">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-accent-ink">
                      <ChevronRight aria-hidden className="size-3.5 transition-transform duration-150 group-open:rotate-90" />
                      {t("Show the math")} · {i.evidenceLabel}
                    </summary>
                    <ul className="mt-2 max-h-48 space-y-1 overflow-auto rounded-ctl bg-surface-1 p-2">
                      {evidence.slice(-12).reverse().map((x) => (
                        <li key={x.id} className="flex items-center justify-between gap-3 text-xs">
                          <span className="min-w-0 truncate text-ink-2">
                            <span className="num text-ink-3">{shortDate(x.date, t.locale)}</span> · {x.merchant}
                          </span>
                          <span className="num font-semibold text-ink-1">{money(x.amount)}</span>
                        </li>
                      ))}
                      {evidence.length > 12 ? <li className="pt-1 text-xs text-ink-3">{t("…and {n} earlier", { n: evidence.length - 12 })}</li> : null}
                    </ul>
                  </details>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function TransactionRow({ txn, accountName, t = EN }: { txn: Transaction; accountName?: string; t?: T }) {
  const incoming = txn.amount > 0;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <CategoryIcon category={txn.category} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink-1">{txn.merchant}</div>
        <div className="truncate text-xs text-ink-3">
          {categoryLabel(txn.category, t)} · {shortDate(txn.date, t.locale)}
          {accountName ? ` · ${accountName}` : ""}
          {txn.pending ? ` · ${t("Pending")}` : ""}
        </div>
      </div>
      <div className={clsx("num shrink-0 text-sm font-bold", incoming ? "text-good-ink" : "text-ink-1")}>
        {incoming ? "+" : ""}
        {money(txn.amount)}
      </div>
    </li>
  );
}

export function UpcomingList({ events, limit = 6, t = EN }: { events: ForecastEvent[]; limit?: number; t?: T }) {
  if (events.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-3">{t("No bills or paychecks expected in the next two weeks.")}</p>;
  }
  return (
    <ul className="divide-y divide-[var(--line)]">
      {events.slice(0, limit).map((e, i) => {
        const incoming = e.amount > 0;
        return (
          <li key={`${e.date}-${e.merchant}-${i}`} className="flex items-center gap-3 py-2.5">
            <div className="grid w-11 shrink-0 place-items-center rounded-ctl bg-surface-2 py-1 text-center leading-tight">
              <span className="text-[10px] font-bold uppercase text-ink-3">{dayDate(e.date, t.locale).split(",")[0]}</span>
              <span className="num text-base font-extrabold text-ink-1">{Number(e.date.slice(8))}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink-1">{e.merchant}</div>
              <div className="text-xs text-ink-3">
                {incoming ? t("Paycheck") : e.kind === "transfer" ? t("Transfer") : e.kind === "subscription" ? t("Subscription") : t("Bill")}
                {e.fromLender ? ` · ${t("from your statement")}` : e.variable ? ` · ${t("estimate")}` : ""}
              </div>
            </div>
            <div className={clsx("num text-sm font-bold", incoming ? "text-good-ink" : "text-ink-1")}>
              {incoming ? "+" : ""}
              {money(e.amount)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function SeeAll({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-0.5 text-xs font-semibold text-accent-ink hover:underline">
      {children}
      <ChevronRight aria-hidden className="size-3.5" />
    </Link>
  );
}

const ALERT_ACTION: Record<Alert["kind"], string> = { bank: msg("Go to Connections"), "bill-short": msg("See the forecast"), "price-rise": msg("See your bills") };

/**
 * What needs acting on now (alerts.ts): a bank that has stopped updating or
 * soon will, a bill the account won't cover. Each says what to do and links
 * to where to do it. Shown only when there is something.
 */
export function HeadsUp({ alerts, t = EN }: { alerts: Alert[]; t?: T }) {
  if (alerts.length === 0) return null;
  return (
    <section aria-label={t("Heads up")} className="rounded-card border border-line bg-surface-1 p-4 shadow-card sm:p-5">
      <ul className="space-y-3">
        {alerts.map((x) => (
          <li key={x.id} className="flex gap-3">
            <div className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2">
              <TriangleAlert aria-hidden className={clsx("size-4", x.urgent ? "text-crit" : "text-warn")} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-3">{t("Heads up")}</div>
              <div className="mt-0.5 text-sm font-bold text-ink-1">{x.title}</div>
              <p className="mt-1 text-[13px] text-ink-2">{x.detail}</p>
              <Link href={x.href} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-accent-ink hover:underline">
                {t(ALERT_ACTION[x.kind])}
                <ChevronRight aria-hidden className="size-3.5" />
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
