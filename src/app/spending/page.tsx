// src/app/spending/page.tsx — the detail behind "where it went".
//
// Hero (the one --gradient-prism card): total spent in the window. Then the
// composition over time, categories against the window before, the busiest
// merchants, a calendar of every day, who owes the person and what their tags
// add up to, and the searchable ledger.

import type { Metadata } from "next";
import Link from "next/link";
import { HandCoins, ShoppingBag, Tag } from "lucide-react";
import { ChartCard } from "@/components/chart-card";
import { BarChart } from "@/components/charts/bar-chart";
import { CalendarHeatmap } from "@/components/charts/calendar-heatmap";
import { Legend } from "@/components/charts/core";
import { CategoryIcon } from "@/components/category-icon";
import { OwedList } from "@/components/owed-list";
import { SplitRules } from "@/components/split-rules";
import { RangeTabs } from "@/components/range-tabs";
import { TransactionsTable } from "@/components/transactions-table";
import { Card, CardHeader, Change, EmptyState, PageHeader } from "@/components/ui";
import { categoryBreakdown, dailySpend, monthlyByCategory, sumSpending, topMerchants } from "@/lib/finance/cashflow";
import { CATEGORIES, categoryColor, SPEND_CATEGORIES } from "@/lib/finance/categories";
import { addDays } from "@/lib/finance/dates";
import { stillOwed, tagTotals } from "@/lib/finance/details";
import { money, money0, monthShort, monthYear, signedMoney0, signedPercent } from "@/lib/finance/format";
import { ledgerHash, monthWindow, parseRange } from "@/lib/finance/view";
import { getFinance } from "@/lib/server/finance";

export const metadata: Metadata = { title: "Spending" };

const HEATMAP_DAYS = 7 * 53;

export default async function SpendingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const range = parseRange((await searchParams).range);
  const data = await getFinance();
  const w = monthWindow(data.today, range);
  const txns = data.transactions;

  const spent = sumSpending(txns, w.from, w.to);
  const before = sumSpending(txns, w.prevFrom, w.prevTo);
  const perMonth = spent / range;
  const rows = categoryBreakdown(txns, { from: w.from, to: w.to }, { from: w.prevFrom, to: w.prevTo });
  const byMonth = monthlyByCategory(txns, w.months);
  const labels = w.months.map((m) => monthYear(`${m}-01`));
  const merchants = topMerchants(txns, w.from, w.to, 8);
  const maxMerchant = merchants[0]?.amount ?? 1;
  const maxRow = rows[0]?.amount ?? 1;
  const days = dailySpend(txns, addDays(data.today, -(HEATMAP_DAYS - 1)), data.today);
  const busiest = [...days].sort((a, b) => b.amount - a.amount)[0];
  const period = `${monthYear(w.from)} – ${monthYear(w.to)}`;
  const accountNames = Object.fromEntries(data.accounts.map((a) => [a.id, a.name]));
  const inWindow = txns.filter((t) => t.date >= w.from && t.date <= w.to);
  // Category fixes live in an account and rename the person's own money, never the example household's.
  const canFix = data.account !== null && data.source !== "demo" && data.view === "me";
  // Who owes them, still open, whenever it was; and their tags over the year the ledger's 12M view shows.
  const owed = canFix ? stillOwed(txns).map(({ t, owed: o }) => ({ id: t.split?.of ?? t.id, who: o.who, amount: o.amount, merchant: t.merchant, date: t.date })) : [];
  const owedTotal = owed.reduce((s, o) => s + o.amount, 0);
  const year = monthWindow(data.today, 12);
  const tags = canFix ? tagTotals(txns.filter((t) => t.date >= year.from && t.date <= year.to)) : [];
  const fixHint = canFix
    ? null
    : data.view === "household"
      ? "Each person fixes their own categories. Switch to Me to fix yours."
      : data.account
      ? "Connect a bank, and you can fix any category Prism gets wrong."
      : data.accountsEnabled
        ? "Wrong category? Sign in and connect your bank to fix it, and Prism remembers it for next time."
        : null;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={period} title="Spending" subtitle="What you spent, where, and when — against the same stretch before it." action={<RangeTabs path="/spending" active={range} />} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card hero className="flex flex-col justify-between p-5 sm:p-6 lg:col-span-4">
          <div>
            <div className="text-sm font-semibold text-[var(--on-hero-soft)]">Spent over {range} months</div>
            <div className="mt-1 text-[44px] font-extrabold leading-none tracking-tight">{money0(spent)}</div>
            <div className="mt-3">
              <Change onHero text={signedMoney0(spent - before)} up={spent > before} goodWhenUp={false} suffix="vs the period before" />
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-ctl bg-[var(--on-hero-faint)] p-3">
              <dt className="text-xs text-[var(--on-hero-soft)]">Per month</dt>
              <dd className="mt-0.5 text-lg font-bold">{money0(perMonth)}</dd>
            </div>
            <div className="rounded-ctl bg-[var(--on-hero-faint)] p-3">
              <dt className="text-xs text-[var(--on-hero-soft)]">Biggest category</dt>
              <dd className="mt-0.5 truncate text-lg font-bold">{rows[0] ? CATEGORIES[rows[0].category].label : "—"}</dd>
            </div>
          </dl>
        </Card>

        <ChartCard
          className="lg:col-span-8"
          title="Month by month, by category"
          subtitle={`Each colour is one category — ${monthShort(w.to)} is still in progress`}
          legend={<Legend items={SPEND_CATEGORIES.map((c) => ({ label: CATEGORIES[c].label, color: categoryColor(c) }))} />}
          table={{
            caption: "Monthly spending by category",
            columns: ["Month", ...SPEND_CATEGORIES.map((c) => CATEGORIES[c].label)],
            rows: byMonth.map((r, i) => [labels[i]!, ...SPEND_CATEGORIES.map((c) => money0(r[c]))]),
          }}
        >
          <BarChart
            mode="stacked"
            labels={labels}
            axisLabels={w.months.map((m) => monthShort(`${m}-01`))}
            series={SPEND_CATEGORIES.map((c) => ({ id: c, label: CATEGORIES[c].label, color: categoryColor(c), values: byMonth.map((r) => Math.max(0, r[c])) }))}
            partial={[labels.length - 1]}
            maxBar={40}
            height={280}
            ariaLabel="Monthly spending stacked by category"
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card className="p-5 sm:p-6 lg:col-span-6">
          <CardHeader title="Categories" subtitle={`Against ${monthYear(w.prevFrom)} – ${monthYear(w.prevTo)}`} />
          {rows.length ? (
            <ul className="mt-4 space-y-3.5">
              {rows.map((r) => (
                <li key={r.category} className="flex items-center gap-3">
                  <CategoryIcon category={r.category} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-ink-1">{CATEGORIES[r.category].label}</span>
                      <span className="num text-sm font-bold text-ink-1">{money0(r.amount)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3">
                      <div className="h-2 flex-1 rounded-pill bg-surface-2">
                        <div className="h-full rounded-pill" style={{ width: `${(r.amount / maxRow) * 100}%`, background: categoryColor(r.category) }} />
                      </div>
                      <span className="w-20 text-right">
                        {r.change === null ? (
                          <span className="text-xs text-ink-3">new</span>
                        ) : (
                          <Change text={signedPercent(r.change)} up={Math.abs(r.change) < 0.005 ? null : r.change > 0} goodWhenUp={false} />
                        )}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={ShoppingBag} title="No spending in this period" body="Each category you spend in gets a bar here, with how it compares to before." />
          )}
        </Card>

        <Card className="p-5 sm:p-6 lg:col-span-6">
          <CardHeader title="Where you spend most" subtitle="Top merchants in this period" />
          <ul className="mt-4 space-y-3">
            {merchants.map((m) => (
              <li key={m.merchant}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-semibold text-ink-1">{m.merchant}</span>
                  <span className="num shrink-0 font-bold text-ink-1">{money0(m.amount)}</span>
                </div>
                <div className="mt-1 flex items-center gap-3">
                  <div className="h-2 flex-1 rounded-pill bg-surface-2">
                    <div className="h-full rounded-pill" style={{ width: `${(m.amount / maxMerchant) * 100}%`, background: categoryColor(m.category) }} />
                  </div>
                  <span className="num w-20 text-right text-xs text-ink-3">
                    {m.count} {m.count === 1 ? "visit" : "visits"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <ChartCard
        title="Every day, at a glance"
        subtitle={
          busiest && busiest.amount > 0
            ? `One square per day — the more you spent, the stronger the colour. Your biggest day was ${money0(busiest.amount)}.`
            : "One square per day — the more you spent, the stronger the colour."
        }
        table={{
          caption: "Daily spending, last 53 weeks",
          columns: ["Day", "Spent"],
          rows: days.filter((d) => d.amount > 0).map((d) => [d.date, money0(d.amount)]),
        }}
      >
        <CalendarHeatmap days={days} ariaLabel="Daily spending over the last year" />
      </ChartCard>

      {canFix ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <Card className="p-5 sm:p-6 lg:col-span-6">
            <CardHeader title="Owed to you" subtitle={owed.length ? `${money(owedTotal)} from ${owed.length} ${owed.length === 1 ? "purchase" : "purchases"}` : "Nothing open"} />
            {/* Mounted even with nobody left, so "Paid back" on the last one keeps its Undo. */}
            <OwedList
              rows={owed}
              empty={<EmptyState icon={HandCoins} title="Nobody owes you right now" body="Covered dinner or bought the tickets? Open the purchase below and say who owes you. It waits here until they pay you back." />}
            />
          </Card>
          <Card className="p-5 sm:p-6 lg:col-span-6">
            <CardHeader title="Your tags" subtitle={tags.length ? "Spent under each, the last 12 months" : "None yet"} />
            {tags.length ? (
              <ul className="mt-3 divide-y divide-[var(--line)]">
                {tags.slice(0, 12).map((g) => (
                  <li key={g.tag}>
                    <Link href={`/spending?range=12${ledgerHash({ find: g.tag })}`} className="-mx-2 flex items-center gap-3 rounded-ctl px-2 py-2.5 transition-colors duration-150 hover:bg-surface-3">
                      <span className="min-w-0 flex-1 text-sm font-semibold text-ink-1">{g.tag}</span>
                      <span className="text-xs text-ink-3">
                        {g.count} {g.count === 1 ? "purchase" : "purchases"}
                      </span>
                      <span className="num w-24 text-right text-sm font-bold text-ink-1">{money0(g.spent)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Tag} title="Total a trip or a project" body="Tag purchases like Vacation 2026 or Kitchen redo to see what each cost across every category. Open any transaction below to add one." />
            )}
          </Card>
          {/* Its own card, shown while there are rules, and kept for the Undo after the last is removed. */}
          <SplitRules rules={data.splitRules} />
        </div>
      ) : null}

      <Card className="p-5 sm:p-6">
        <div id="transactions" className="scroll-mt-24">
          <CardHeader title="Transactions" subtitle={`Everything in ${period}`} />
        </div>
        <div className="mt-4">
          <TransactionsTable transactions={inWindow} accountNames={accountNames} canFix={canFix} fixHint={fixHint} ruleShops={canFix ? data.splitRules.map((r) => r.key) : []} />
        </div>
      </Card>
    </div>
  );
}
