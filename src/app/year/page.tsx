// src/app/year/page.tsx — one year on one page: what came in, where it went,
// who was paid most, and how far net worth moved. Print it, or save it as a
// PDF, for taxes or a look back (printing is always in the light theme).
//
// Hero (the one --gradient-prism card): what you kept. Every figure is counted
// the way the other screens count it (finance/year.ts), and the page is
// honest about where Prism's records start and about a year still under way.

import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { CalendarRange, Download } from "lucide-react";
import { StatTile } from "@/components/blocks";
import { CategoryIcon } from "@/components/category-icon";
import { ChartCard } from "@/components/chart-card";
import { BarChart } from "@/components/charts/bar-chart";
import { Legend } from "@/components/charts/core";
import { buttonGhost } from "@/components/dialog";
import { PrintButton } from "@/components/print-button";
import { ButtonLink, Card, CardHeader, Change, EmptyState, PageHeader } from "@/components/ui";
import { CATEGORIES, categoryColor } from "@/lib/finance/categories";
import { addDays, startOfMonth } from "@/lib/finance/dates";
import { dayDate, money, money0, monthLong, monthShort, monthYear, percent, shortDate, signedMoney0, signedPercent } from "@/lib/finance/format";
import { defaultYear, reviewYears, yearReview, type YearTotals } from "@/lib/finance/year";
import { getFinance } from "@/lib/server/finance";

export const metadata: Metadata = { title: "Your year" };

/** "$1,200 more than the same stretch last year", in words beside the arrow, so it never rests on a symbol. */
function versus(now: number, before: number | null, goodWhenUp: boolean, span: string) {
  if (before === null) return null;
  const d = now - before;
  return <Change text={signedMoney0(d)} up={Math.abs(d) < 100 ? null : d > 0} goodWhenUp={goodWhenUp} suffix={`vs ${span}`} />;
}

function keptLine(t: YearTotals): string {
  if (t.income <= 0) return "No income came in over this stretch.";
  if (t.kept <= 0) return `You spent ${money0(-t.kept)} more than came in.`;
  return `${percent(Math.max(0, t.savingsRate ?? 0))} of everything that came in.`;
}

export default async function YearPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const data = await getFinance();
  const years = reviewYears(data);
  const raw = (await searchParams).y;
  const asked = typeof raw === "string" && /^\d{4}$/.test(raw) ? Number(raw) : null;
  const year = asked !== null && years.includes(asked) ? asked : defaultYear(data);
  const r = yearReview(data, year);
  const span = r.partial ? `${shortDate(r.from)} – ${shortDate(r.to)}` : r.recordsFrom ? `${shortDate(r.from)} – Dec 31` : "the whole year";
  const lastYear = r.partial || r.recordsFrom ? "the same stretch last year" : String(year - 1);
  // Only a signed-in person's own money can be downloaded; the example household and a household view can't.
  const canDownload = data.account !== null && data.source !== "demo" && data.view === "me";
  const maxCategory = r.categories[0]?.amount ?? 1;
  const maxMerchant = r.merchants[0]?.amount ?? 1;
  const labels = r.months.map((m) => monthYear(`${m.month}-01`));
  const axis = r.months.map((m) => monthShort(`${m.month}-01`));
  const inProgress = r.partial ? [r.months.length - 1] : [];

  const tabs =
    years.length > 1 ? (
      <nav aria-label="Year" className="inline-flex rounded-ctl border border-line bg-surface-1 p-1 shadow-card print:hidden">
        {years.slice(0, 3).map((y) => (
          <Link
            key={y}
            href={`/year?y=${y}`}
            scroll={false}
            aria-current={y === year ? "true" : undefined}
            className={clsx(
              "rounded-[calc(var(--radius-ctl)-4px)] px-3 py-1.5 text-xs font-bold transition-colors duration-150",
              y === year ? "bg-button text-ink-on-accent" : "text-ink-2 hover:bg-surface-3 hover:text-ink-1",
            )}
          >
            {y}
          </Link>
        ))}
      </nav>
    ) : null;

  const header = (
    <PageHeader
      eyebrow={r.partial ? `${year} so far · ${shortDate(r.from)} – ${shortDate(r.to)}` : `${shortDate(r.from)} – Dec 31, ${year}`}
      title={`Your ${year}`}
      subtitle="The year on one page: what came in, where it went, and how far you came."
      action={tabs}
    />
  );

  if (r.transactions === 0) {
    return (
      <div className="space-y-5">
        {header}
        <Card className="p-5 sm:p-6">
          <EmptyState
            icon={CalendarRange}
            title={`Nothing from ${year} yet`}
            body="Your year appears here once Prism has your transactions: link a bank, or import your history from Mint, Monarch or a spreadsheet."
            action={
              <ButtonLink href="/connections" variant="primary">
                Go to Connections
              </ButtonLink>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}

      {r.recordsFrom ? (
        <p className="rounded-ctl border border-line bg-surface-1 px-4 py-3 text-sm text-ink-2">
          Prism&apos;s records start on {dayDate(r.recordsFrom)}, so this year does too. Import older history on Connections to fill in the months before.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:gap-5 md:grid-cols-4">
        <Card hero className="p-5 md:col-span-2">
          <div className="text-sm font-semibold text-[var(--on-hero-soft)]">You kept</div>
          <div className="mt-1 text-[44px] font-extrabold leading-none tracking-tight">{money0(Math.max(0, r.totals.kept))}</div>
          <p className="mt-2 text-sm text-[var(--on-hero-soft)]">{keptLine(r.totals)}</p>
          {r.before ? (
            <p className="mt-1 text-sm text-[var(--on-hero-soft)]">
              {r.before.kept > 0 ? `${money0(r.before.kept)} over ${lastYear}.` : `Nothing kept over ${lastYear}.`}
            </p>
          ) : null}
        </Card>
        <StatTile label="Money in" value={money0(r.totals.income)} change={versus(r.totals.income, r.before?.income ?? null, true, lastYear)} foot={r.before ? null : <span>{span}</span>} spark={r.months.map((m) => m.income)} sparkColor="var(--flow-in)" />
        <StatTile label="Money out" value={money0(r.totals.spending)} change={versus(r.totals.spending, r.before?.spending ?? null, false, lastYear)} foot={r.before ? null : <span>{span}</span>} spark={r.months.map((m) => m.spending)} sparkColor="var(--flow-out)" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-5 md:grid-cols-3">
        <StatTile
          label="Net worth"
          value={r.netWorth.end === null ? "—" : money0(r.netWorth.end)}
          change={
            r.netWorth.start !== null && r.netWorth.end !== null ? (
              <Change text={signedMoney0(r.netWorth.end - r.netWorth.start)} up={r.netWorth.end === r.netWorth.start ? null : r.netWorth.end > r.netWorth.start} suffix={`since ${monthYear(addDays(startOfMonth(r.from), -1))} ended`} />
            ) : (
              <span>{r.partial ? "today" : `at the end of ${year}`}</span>
            )
          }
        />
        <StatTile label="Pay" value={money0(r.pay)} foot={<span>paychecks and other pay, {span}</span>} />
        <StatTile
          label="Subscriptions"
          value={money0(r.subscriptions.total)}
          foot={<span>{r.subscriptions.count ? `${r.subscriptions.count} ${r.subscriptions.count === 1 ? "subscription" : "subscriptions"}, ${span}` : `none found, ${span}`}</span>}
        />
      </div>

      <ChartCard
        title="Month by month"
        subtitle={r.partial ? `${monthLong(r.to)} is still in progress` : `Every month of ${year}, in and out`}
        legend={
          <Legend
            items={[
              { label: "Money in", color: "var(--flow-in)" },
              { label: "Money out", color: "var(--flow-out)" },
            ]}
          />
        }
        table={{
          caption: `Money in and out each month of ${year}`,
          columns: ["Month", "In", "Out", "Kept"],
          rows: r.months.map((m, i) => [labels[i]!, money0(m.income), money0(m.spending), signedMoney0(m.net)]),
        }}
      >
        <BarChart
          labels={labels}
          axisLabels={axis}
          series={[
            { id: "in", label: "Money in", color: "var(--flow-in)", values: r.months.map((m) => m.income) },
            { id: "out", label: "Money out", color: "var(--flow-out)", values: r.months.map((m) => m.spending) },
          ]}
          partial={inProgress}
          height={260}
          ariaLabel={`Money in and out each month of ${year}`}
        />
      </ChartCard>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <CardHeader title="Where it went" subtitle={r.before ? `Each category's share, and how it compares with ${lastYear}` : "Each category's share of what you spent"} />
          <ul className="mt-4 space-y-3.5">
            {r.categories.map((c) => (
              <li key={c.category} className="flex items-center gap-3">
                <CategoryIcon category={c.category} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-ink-1">{CATEGORIES[c.category].label}</span>
                    <span className="num text-sm font-bold text-ink-1">{money0(c.amount)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3">
                    <div className="h-2 flex-1 rounded-pill bg-surface-2">
                      <div className="h-full rounded-pill" style={{ width: `${(c.amount / maxCategory) * 100}%`, background: categoryColor(c.category) }} />
                    </div>
                    <span className="num w-10 text-right text-xs text-ink-3">{percent(c.share)}</span>
                    {c.before === null ? null : (
                      <span className="w-14 text-right">
                        {c.before > 0 ? (
                          <Change text={signedPercent((c.amount - c.before) / c.before)} up={Math.abs(c.amount - c.before) / c.before < 0.005 ? null : c.amount > c.before} goodWhenUp={false} />
                        ) : (
                          <span className="text-xs text-ink-3">new</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5 sm:p-6">
          <CardHeader title="Who you paid most" subtitle={`The ten places that took the most, ${span}`} />
          <ul className="mt-4 space-y-3.5">
            {r.merchants.map((m) => (
              <li key={m.merchant}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold text-ink-1">{m.merchant}</span>
                  <span className="num shrink-0 font-bold text-ink-1">{money0(m.amount)}</span>
                </div>
                <div className="mt-1 flex items-center gap-3">
                  <div className="h-2 flex-1 rounded-pill bg-surface-2">
                    <div className="h-full rounded-pill" style={{ width: `${(m.amount / maxMerchant) * 100}%`, background: categoryColor(m.category) }} />
                  </div>
                  <span className="num w-20 text-right text-xs text-ink-3">
                    {m.count} {m.count === 1 ? "time" : "times"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="p-5 sm:p-6">
        <CardHeader title="The year in a few lines" subtitle="What stood out" />
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {r.biggest ? (
            <div>
              <dt className="text-xs font-semibold text-ink-3">Biggest one-off purchase</dt>
              <dd className="mt-1 text-sm text-ink-1">
                <span className="num font-bold">{money(-r.biggest.amount)}</span> at {r.biggest.merchant}, {dayDate(r.biggest.date)}
              </dd>
            </div>
          ) : null}
          {r.busiest ? (
            <div>
              <dt className="text-xs font-semibold text-ink-3">Costliest month</dt>
              <dd className="mt-1 text-sm text-ink-1">
                {monthLong(r.busiest.month)}, <span className="num font-bold">{money0(r.busiest.spending)}</span> out
              </dd>
            </div>
          ) : null}
          {r.quietest ? (
            <div>
              <dt className="text-xs font-semibold text-ink-3">Lightest month</dt>
              <dd className="mt-1 text-sm text-ink-1">
                {monthLong(r.quietest.month)}, <span className="num font-bold">{money0(r.quietest.spending)}</span> out
              </dd>
            </div>
          ) : null}
          {r.subscriptions.list[0] ? (
            <div>
              <dt className="text-xs font-semibold text-ink-3">Biggest subscription</dt>
              <dd className="mt-1 text-sm text-ink-1">
                {r.subscriptions.list[0].merchant}, <span className="num font-bold">{money0(r.subscriptions.list[0].total)}</span> {r.partial ? "so far" : "for the year"}
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        {canDownload ? (
          <a href={`/account/export/transactions.csv?year=${year}`} className={buttonGhost}>
            <Download aria-hidden className="size-4" />
            Download {year}&apos;s transactions
          </a>
        ) : null}
        <PrintButton />
        <Link href={`/taxes?y=${year}`} className="text-sm font-semibold text-accent-ink underline-offset-2 hover:underline">
          See {year} for your taxes
        </Link>
        <span className="text-xs text-ink-3">Information, not financial or tax advice. {r.transactions.toLocaleString("en-US")} transactions counted.</span>
      </div>
    </div>
  );
}
