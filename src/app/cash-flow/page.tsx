// src/app/cash-flow/page.tsx — where the money came from and went.
//
// Hero (the one --gradient-prism card): what you kept. The star chart is the
// Sankey. Everything on the screen is scoped by the range row.

import type { Metadata } from "next";
import { Waves } from "lucide-react";
import { StatTile } from "@/components/blocks";
import { ChartCard } from "@/components/chart-card";
import { IncomeCards } from "@/components/income";
import { BarChart } from "@/components/charts/bar-chart";
import { Legend } from "@/components/charts/core";
import { SankeyChart } from "@/components/charts/sankey-chart";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { RangeTabs } from "@/components/range-tabs";
import { Card, Change, EmptyState, PageHeader } from "@/components/ui";
import { categoryTotals, incomeSources, monthlyCashFlow, sumIncome, sumSpending } from "@/lib/finance/cashflow";
import { capitalized, money0, monthLong, monthShort, monthYear, percent, signedMoney0 } from "@/lib/finance/format";
import { incomeSummary } from "@/lib/finance/income";
import { detectRecurring } from "@/lib/finance/recurring";
import { buildCashFlowSankey } from "@/lib/finance/sankey";
import { againstLabel, monthHref, periodLabel, rangeView } from "@/lib/finance/view";
import { getFinance } from "@/lib/server/finance";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Cash flow") };
}

export default async function CashFlowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [data, t] = await Promise.all([getFinance(), getT()]);
  const { locale } = t;
  const { range, month, w, step } = rangeView(await searchParams, data.today, data.transactions);
  const txns = data.transactions;

  const income = sumIncome(txns, w.from, w.to);
  const spending = sumSpending(txns, w.from, w.to);
  const prevIncome = sumIncome(txns, w.prevFrom, w.prevTo);
  const prevSpending = sumSpending(txns, w.prevFrom, w.prevTo);
  const kept = income - spending;
  const rate = income > 0 ? kept / income : null;

  const graph = buildCashFlowSankey(incomeSources(txns, w.from, w.to, 3), categoryTotals(txns, w.from, w.to), t);
  const flows = monthlyCashFlow(txns, w.trend);
  const labels = flows.map((f) => capitalized(monthYear(`${f.month}-01`, locale)));
  const axis = flows.map((f) => capitalized(monthShort(`${f.month}-01`, locale)));
  // The last month is still in progress unless a past month is being looked at.
  const inProgress = w.to === data.today;
  const partial = inProgress ? [flows.length - 1] : [];
  // Each month's bars open that month on its own.
  const months = flows.map((f) => monthHref("/cash-flow", f.month, data.today));
  // Lower case inside a Spanish sentence; a capital where it heads the page.
  const period = periodLabel(w.from, w.to, locale);
  // One month is set against the same days of the last one; longer windows against the stretch before.
  const against = range === 1 ? t("vs {month}", { month: againstLabel(w.prevFrom, w.prevTo, locale) }) : t("vs previous {n} mo", { n: range });
  const kept0 = rate !== null ? percent(Math.max(0, rate)) : "";
  const earning = incomeSummary(txns, detectRecurring(txns, data.today), data.today);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={capitalized(period)}
        title={t("Cash flow")}
        subtitle={t("Every dollar in, and exactly where it went.")}
        action={<RangeTabs path="/cash-flow" active={range} step={step} t={t} />}
      />

      <div className="grid grid-cols-1 gap-3 sm:gap-5 md:grid-cols-4">
        <Card hero className="p-5 md:col-span-2">
          <div className="text-sm font-semibold text-[var(--on-hero-soft)]">{t("You kept")}</div>
          <div className="mt-1 text-[44px] font-extrabold leading-none tracking-tight">{money0(Math.max(0, kept))}</div>
          <p className="mt-2 text-sm text-[var(--on-hero-soft)]">
            {rate === null
              ? t("No income in this period yet.")
              : range > 1
                ? t("{pct} of everything that came in over {n} months.", { pct: kept0, n: range })
                : month
                  ? t("{pct} of everything that came in during {month}.", { pct: kept0, month: monthLong(w.from, locale) })
                  : t("{pct} of everything that came in this month so far.", { pct: kept0 })}
          </p>
        </Card>
        <StatTile
          label={t("Money in")}
          value={money0(income)}
          change={<Change t={t} text={signedMoney0(income - prevIncome)} up={income >= prevIncome} suffix={against} />}
          spark={flows.map((f) => f.income)}
          sparkColor="var(--flow-in)"
        />
        <StatTile
          label={t("Money out")}
          value={money0(spending)}
          change={<Change t={t} text={signedMoney0(spending - prevSpending)} up={spending > prevSpending} goodWhenUp={false} suffix={against} />}
          spark={flows.map((f) => f.spending)}
          sparkColor="var(--flow-out)"
        />
      </div>

      <ChartCard
        title={t("The flow")}
        subtitle={t("Hover any band to see how much of your income it carried")}
        table={{
          caption: t("Cash flow from income sources to categories"),
          columns: [t("Flow"), t("Amount"), t("Share of income")],
          rows: graph.links.map((l) => {
            const from = graph.nodes.find((n) => n.id === l.source)!;
            const to = graph.nodes.find((n) => n.id === l.target)!;
            return [`${from.label} → ${to.label}`, money0(l.value), graph.total > 0 ? percent(l.value / graph.total) : "—"];
          }),
        }}
      >
        {graph.total > 0 ? (
          <SankeyChart graph={graph} height={420} ariaLabel={t("Cash flow for {period}: {in} in, {out} out.", { period, in: money0(income), out: money0(spending) })} />
        ) : (
          <EmptyState icon={Waves} title={t("No money has moved yet")} body={t("Once income and spending land, this shows every dollar flowing from paycheck to category.")} />
        )}
      </ChartCard>

      <IncomeCards income={earning} accounts={data.accounts} demo={data.source === "demo"} household={data.view === "household"} t={t} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <ChartCard
          className="lg:col-span-7"
          title={t("In vs out, month by month")}
          subtitle={inProgress ? t("{Month} is still in progress", { month: monthShort(w.to, locale) }) : t("Both months in full")}
          legend={
            <Legend
              items={[
                { label: t("Money in"), color: "var(--flow-in)" },
                { label: t("Money out"), color: "var(--flow-out)" },
              ]}
            />
          }
          table={{
            caption: t("Monthly income and spending"),
            columns: [t("Month"), t("In"), t("Out"), t("Kept")],
            rows: flows.map((f, i) => [labels[i]!, money0(f.income), money0(f.spending), signedMoney0(f.net)]),
          }}
        >
          <BarChart
            labels={labels}
            axisLabels={axis}
            series={[
              { id: "in", label: t("Money in"), color: "var(--flow-in)", values: flows.map((f) => f.income) },
              { id: "out", label: t("Money out"), color: "var(--flow-out)", values: flows.map((f) => f.spending) },
            ]}
            partial={partial}
            hrefs={months}
            hrefNote={t("Tap or click to see this month")}
            height={260}
            ariaLabel={t("Monthly money in and money out")}
          />
        </ChartCard>

        <ChartCard
          className="lg:col-span-5"
          title={t("What you kept each month")}
          subtitle={t("Above the line you saved; below, you dipped into savings")}
          table={{
            caption: t("Net kept per month"),
            columns: [t("Month"), t("Kept")],
            rows: flows.map((f, i) => [labels[i]!, signedMoney0(f.net)]),
          }}
        >
          <BarChart
            labels={labels}
            axisLabels={axis}
            series={[{ id: "net", label: t("Kept"), color: "var(--flow-in)", negativeColor: "var(--flow-out)", values: flows.map((f) => f.net) }]}
            partial={partial}
            hrefs={months}
            hrefNote={t("Tap or click to see this month")}
            height={260}
            ariaLabel={t("Net amount kept each month")}
          />
        </ChartCard>
      </div>

      <ChartCard
        title={t("Savings rate")}
        subtitle={t("The share of each month's income you kept — 20% is a common target")}
        legend={
          <Legend
            items={[
              { label: t("Savings rate"), color: "var(--c-4)", kind: "line" },
              { label: t("20% target"), color: "var(--c-other)", kind: "line" },
            ]}
          />
        }
        table={{
          caption: t("Savings rate by month"),
          columns: [t("Month"), t("Savings rate")],
          rows: flows.map((f, i) => [labels[i]!, f.savingsRate === null ? "—" : percent(f.savingsRate)]),
        }}
      >
        <TimeSeriesChart
          labels={labels}
          axisLabels={axis}
          series={[
            { id: "target", label: t("20% target"), color: "var(--c-other)", values: flows.map(() => 0.2), muted: true },
            { id: "rate", label: t("Savings rate"), color: "var(--c-4)", values: flows.map((f) => f.savingsRate), area: true },
          ]}
          format="percent"
          axisFormat="percent"
          include={0}
          height={220}
          ariaLabel={t("Savings rate by month against a 20% target")}
        />
      </ChartCard>
    </div>
  );
}
