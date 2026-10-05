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
import { categoryColor, categoryLabel } from "@/lib/finance/categories";
import { addDays, startOfMonth } from "@/lib/finance/dates";
import { capitalized, dayDate, money, money0, monthLong, monthShort, monthYear, percent, shortDate, signedMoney0, signedPercent } from "@/lib/finance/format";
import { defaultYear, reviewYears, yearReview, type YearTotals } from "@/lib/finance/year";
import { getFinance } from "@/lib/server/finance";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/t";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Your year") };
}

/** "$1,200 more than the same stretch last year", in words beside the arrow, so it never rests on a symbol. */
function versus(now: number, before: number | null, goodWhenUp: boolean, suffix: string, t: T) {
  if (before === null) return null;
  const d = now - before;
  return <Change t={t} text={signedMoney0(d)} up={Math.abs(d) < 100 ? null : d > 0} goodWhenUp={goodWhenUp} suffix={suffix} />;
}

function keptLine(totals: YearTotals, t: T): string {
  if (totals.income <= 0) return t("No income came in over this stretch.");
  if (totals.kept <= 0) return t("You spent {amount} more than came in.", { amount: money0(-totals.kept) });
  return t("{pct} of everything that came in.", { pct: percent(Math.max(0, totals.savingsRate ?? 0)) });
}

/** A translated sentence with its amount in bold, wherever the language puts it. */
function withAmount(sentence: string, amount: string) {
  const at = sentence.indexOf("{amount}");
  if (at < 0) return sentence;
  return (
    <>
      {sentence.slice(0, at)}
      <span className="num font-bold">{amount}</span>
      {sentence.slice(at + "{amount}".length)}
    </>
  );
}

export default async function YearPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [data, t] = await Promise.all([getFinance(), getT()]);
  const { locale } = t;
  const years = reviewYears(data);
  const raw = (await searchParams).y;
  const asked = typeof raw === "string" && /^\d{4}$/.test(raw) ? Number(raw) : null;
  const year = asked !== null && years.includes(asked) ? asked : defaultYear(data);
  const r = yearReview(data, year);
  const dec31 = shortDate(`${year}-12-31`, locale);
  const span = r.partial ? `${shortDate(r.from, locale)} – ${shortDate(r.to, locale)}` : r.recordsFrom ? `${shortDate(r.from, locale)} – ${dec31}` : t("the whole year");
  // The year before, all of it, or the same stretch of it when this one is only part of a year.
  const sameStretch = r.partial || r.recordsFrom !== null;
  const prior = year - 1;
  const vsLast = sameStretch ? t("vs the same stretch last year") : t("vs {year}", { year: prior });
  // Only a signed-in person's own money can be downloaded; the example household and a household view can't.
  const canDownload = data.account !== null && data.source !== "demo" && data.view === "me";
  const maxCategory = r.categories[0]?.amount ?? 1;
  const maxMerchant = r.merchants[0]?.amount ?? 1;
  const labels = r.months.map((m) => capitalized(monthYear(`${m.month}-01`, locale)));
  const axis = r.months.map((m) => capitalized(monthShort(`${m.month}-01`, locale)));
  const inProgress = r.partial ? [r.months.length - 1] : [];

  const tabs =
    years.length > 1 ? (
      <nav aria-label={t("Year")} className="inline-flex rounded-ctl border border-line bg-surface-1 p-1 shadow-card print:hidden">
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
      eyebrow={
        r.partial
          ? t("{year} so far · {from} – {to}", { year, from: shortDate(r.from, locale), to: shortDate(r.to, locale) })
          : t("{from} – {to}, {year}", { from: shortDate(r.from, locale), to: dec31, year })
      }
      title={t("Your {year}", { year })}
      subtitle={t("The year on one page: what came in, where it went, and how far you came.")}
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
            title={t("Nothing from {year} yet", { year })}
            body={t("Your year appears here once Prism has your transactions: link a bank, or import your history from Mint, Monarch or a spreadsheet.")}
            action={
              <ButtonLink href="/connections" variant="primary">
                {t("Go to Connections")}
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
          {t("Prism's records start on {date}, so this year does too. Import older history on Connections to fill in the months before.", { date: dayDate(r.recordsFrom, locale) })}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:gap-5 md:grid-cols-4">
        <Card hero className="p-5 md:col-span-2">
          <div className="text-sm font-semibold text-[var(--on-hero-soft)]">{t("You kept")}</div>
          <div className="mt-1 text-[44px] font-extrabold leading-none tracking-tight">{money0(Math.max(0, r.totals.kept))}</div>
          <p className="mt-2 text-sm text-[var(--on-hero-soft)]">{keptLine(r.totals, t)}</p>
          {r.before ? (
            <p className="mt-1 text-sm text-[var(--on-hero-soft)]">
              {r.before.kept > 0
                ? sameStretch
                  ? t("{amount} over the same stretch last year.", { amount: money0(r.before.kept) })
                  : t("{amount} over {year}.", { amount: money0(r.before.kept), year: prior })
                : sameStretch
                  ? t("Nothing kept over the same stretch last year.")
                  : t("Nothing kept over {year}.", { year: prior })}
            </p>
          ) : null}
        </Card>
        <StatTile label={t("Money in")} value={money0(r.totals.income)} change={versus(r.totals.income, r.before?.income ?? null, true, vsLast, t)} foot={r.before ? null : <span>{span}</span>} spark={r.months.map((m) => m.income)} sparkColor="var(--flow-in)" />
        <StatTile label={t("Money out")} value={money0(r.totals.spending)} change={versus(r.totals.spending, r.before?.spending ?? null, false, vsLast, t)} foot={r.before ? null : <span>{span}</span>} spark={r.months.map((m) => m.spending)} sparkColor="var(--flow-out)" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-5 md:grid-cols-3">
        <StatTile
          label={t("Net worth")}
          value={r.netWorth.end === null ? "—" : money0(r.netWorth.end)}
          change={
            r.netWorth.start !== null && r.netWorth.end !== null ? (
              <Change
                t={t}
                text={signedMoney0(r.netWorth.end - r.netWorth.start)}
                up={r.netWorth.end === r.netWorth.start ? null : r.netWorth.end > r.netWorth.start}
                suffix={t("since {month} ended", { month: monthYear(addDays(startOfMonth(r.from), -1), locale) })}
              />
            ) : (
              <span>{r.partial ? t("today") : t("at the end of {year}", { year })}</span>
            )
          }
        />
        <StatTile label={t("Pay")} value={money0(r.pay)} foot={<span>{t("paychecks and other pay, {span}", { span })}</span>} />
        <StatTile
          label={t("Subscriptions")}
          value={money0(r.subscriptions.total)}
          foot={
            <span>
              {r.subscriptions.count === 0
                ? t("none found, {span}", { span })
                : r.subscriptions.count === 1
                  ? t("1 subscription, {span}", { span })
                  : t("{n} subscriptions, {span}", { n: r.subscriptions.count, span })}
            </span>
          }
        />
      </div>

      <ChartCard
        title={t("Month by month")}
        subtitle={r.partial ? t("{Month} is still in progress", { month: monthLong(r.to, locale) }) : t("Every month of {year}, in and out", { year })}
        legend={
          <Legend
            items={[
              { label: t("Money in"), color: "var(--flow-in)" },
              { label: t("Money out"), color: "var(--flow-out)" },
            ]}
          />
        }
        table={{
          caption: t("Money in and out each month of {year}", { year }),
          columns: [t("Month"), t("In"), t("Out"), t("Kept")],
          rows: r.months.map((m, i) => [labels[i]!, money0(m.income), money0(m.spending), signedMoney0(m.net)]),
        }}
      >
        <BarChart
          labels={labels}
          axisLabels={axis}
          series={[
            { id: "in", label: t("Money in"), color: "var(--flow-in)", values: r.months.map((m) => m.income) },
            { id: "out", label: t("Money out"), color: "var(--flow-out)", values: r.months.map((m) => m.spending) },
          ]}
          partial={inProgress}
          height={260}
          ariaLabel={t("Money in and out each month of {year}", { year })}
        />
      </ChartCard>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <CardHeader
            title={t("Where it went")}
            subtitle={
              r.before
                ? sameStretch
                  ? t("Each category's share, and how it compares with the same stretch last year")
                  : t("Each category's share, and how it compares with {year}", { year: prior })
                : t("Each category's share of what you spent")
            }
          />
          <ul className="mt-4 space-y-3.5">
            {r.categories.map((c) => (
              <li key={c.category} className="flex items-center gap-3">
                <CategoryIcon category={c.category} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-ink-1">{categoryLabel(c.category, t)}</span>
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
                          <Change t={t} text={signedPercent((c.amount - c.before) / c.before)} up={Math.abs(c.amount - c.before) / c.before < 0.005 ? null : c.amount > c.before} goodWhenUp={false} />
                        ) : (
                          <span className="text-xs text-ink-3">{t("new")}</span>
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
          <CardHeader title={t("Who you paid most")} subtitle={t("The ten places that took the most, {span}", { span })} />
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
                  <span className="num w-20 text-right text-xs text-ink-3">{m.count === 1 ? t("1 time") : t("{n} times", { n: m.count })}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="p-5 sm:p-6">
        <CardHeader title={t("The year in a few lines")} subtitle={t("What stood out")} />
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {r.biggest ? (
            <div>
              <dt className="text-xs font-semibold text-ink-3">{t("Biggest one-off purchase")}</dt>
              <dd className="mt-1 text-sm text-ink-1">
                {withAmount(t("{amount} at {merchant}, {date}", { merchant: r.biggest.merchant, date: dayDate(r.biggest.date, locale) }), money(-r.biggest.amount))}
              </dd>
            </div>
          ) : null}
          {r.busiest ? (
            <div>
              <dt className="text-xs font-semibold text-ink-3">{t("Costliest month")}</dt>
              <dd className="mt-1 text-sm text-ink-1">{withAmount(t("{month}, {amount} out", { month: monthLong(r.busiest.month, locale) }), money0(r.busiest.spending))}</dd>
            </div>
          ) : null}
          {r.quietest ? (
            <div>
              <dt className="text-xs font-semibold text-ink-3">{t("Lightest month")}</dt>
              <dd className="mt-1 text-sm text-ink-1">{withAmount(t("{month}, {amount} out", { month: monthLong(r.quietest.month, locale) }), money0(r.quietest.spending))}</dd>
            </div>
          ) : null}
          {r.subscriptions.list[0] ? (
            <div>
              <dt className="text-xs font-semibold text-ink-3">{t("Biggest subscription")}</dt>
              <dd className="mt-1 text-sm text-ink-1">
                {withAmount(
                  r.partial ? t("{merchant}, {amount} so far", { merchant: r.subscriptions.list[0].merchant }) : t("{merchant}, {amount} for the year", { merchant: r.subscriptions.list[0].merchant }),
                  money0(r.subscriptions.list[0].total),
                )}
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        {canDownload ? (
          <a href={`/account/export/transactions.csv?year=${year}`} className={buttonGhost}>
            <Download aria-hidden className="size-4" />
            {t("Download {year}'s transactions", { year })}
          </a>
        ) : null}
        <PrintButton />
        <Link href={`/taxes?y=${year}`} className="text-sm font-semibold text-accent-ink underline-offset-2 hover:underline">
          {t("See {year} for your taxes", { year })}
        </Link>
        <span className="text-xs text-ink-3">{r.transactions === 1
            ? t("Information, not financial or tax advice. 1 transaction counted.")
            : t("Information, not financial or tax advice. {n} transactions counted.", { n: r.transactions.toLocaleString("en-US") })}</span>
      </div>
    </div>
  );
}
