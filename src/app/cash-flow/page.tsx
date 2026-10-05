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
import { money0, monthLong, monthShort, monthYear, percent, signedMoney0 } from "@/lib/finance/format";
import { incomeSummary } from "@/lib/finance/income";
import { detectRecurring } from "@/lib/finance/recurring";
import { buildCashFlowSankey } from "@/lib/finance/sankey";
import { againstLabel, periodLabel, rangeView } from "@/lib/finance/view";
import { getFinance } from "@/lib/server/finance";

export const metadata: Metadata = { title: "Cash flow" };

export default async function CashFlowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const data = await getFinance();
  const { range, month, w, step } = rangeView(await searchParams, data.today, data.transactions);
  const txns = data.transactions;

  const income = sumIncome(txns, w.from, w.to);
  const spending = sumSpending(txns, w.from, w.to);
  const prevIncome = sumIncome(txns, w.prevFrom, w.prevTo);
  const prevSpending = sumSpending(txns, w.prevFrom, w.prevTo);
  const kept = income - spending;
  const rate = income > 0 ? kept / income : null;

  const graph = buildCashFlowSankey(incomeSources(txns, w.from, w.to, 3), categoryTotals(txns, w.from, w.to));
  const flows = monthlyCashFlow(txns, w.trend);
  const labels = flows.map((f) => monthYear(`${f.month}-01`));
  const axis = flows.map((f) => monthShort(`${f.month}-01`));
  // The last month is still in progress unless a past month is being looked at.
  const inProgress = w.to === data.today;
  const partial = inProgress ? [flows.length - 1] : [];
  const period = periodLabel(w.from, w.to);
  // One month is set against the same days of the last one; longer windows against the stretch before.
  const against = range === 1 ? `vs ${againstLabel(w.prevFrom, w.prevTo)}` : `vs previous ${range} mo`;
  const earning = incomeSummary(txns, detectRecurring(txns, data.today), data.today);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={period} title="Cash flow" subtitle="Every dollar in, and exactly where it went." action={<RangeTabs path="/cash-flow" active={range} step={step} />} />

      <div className="grid grid-cols-1 gap-3 sm:gap-5 md:grid-cols-4">
        <Card hero className="p-5 md:col-span-2">
          <div className="text-sm font-semibold text-[var(--on-hero-soft)]">You kept</div>
          <div className="mt-1 text-[44px] font-extrabold leading-none tracking-tight">{money0(Math.max(0, kept))}</div>
          <p className="mt-2 text-sm text-[var(--on-hero-soft)]">
            {rate !== null ? `${percent(Math.max(0, rate))} of everything that came in ${range > 1 ? `over ${range} months` : month ? `during ${monthLong(w.from)}` : "this month so far"}.` : "No income in this period yet."}
          </p>
        </Card>
        <StatTile
          label="Money in"
          value={money0(income)}
          change={<Change text={signedMoney0(income - prevIncome)} up={income >= prevIncome} suffix={against} />}
          spark={flows.map((f) => f.income)}
          sparkColor="var(--flow-in)"
        />
        <StatTile
          label="Money out"
          value={money0(spending)}
          change={<Change text={signedMoney0(spending - prevSpending)} up={spending > prevSpending} goodWhenUp={false} suffix={against} />}
          spark={flows.map((f) => f.spending)}
          sparkColor="var(--flow-out)"
        />
      </div>

      <ChartCard
        title="The flow"
        subtitle="Hover any band to see how much of your income it carried"
        table={{
          caption: "Cash flow from income sources to categories",
          columns: ["Flow", "Amount", "Share of income"],
          rows: graph.links.map((l) => {
            const s = graph.nodes.find((n) => n.id === l.source)!;
            const t = graph.nodes.find((n) => n.id === l.target)!;
            return [`${s.label} → ${t.label}`, money0(l.value), graph.total > 0 ? percent(l.value / graph.total) : "—"];
          }),
        }}
      >
        {graph.total > 0 ? (
          <SankeyChart graph={graph} height={420} ariaLabel={`Cash flow for ${period}: ${money0(income)} in, ${money0(spending)} out.`} />
        ) : (
          <EmptyState icon={Waves} title="No money has moved yet" body="Once income and spending land, this shows every dollar flowing from paycheck to category." />
        )}
      </ChartCard>

      <IncomeCards income={earning} accounts={data.accounts} demo={data.source === "demo"} household={data.view === "household"} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <ChartCard
          className="lg:col-span-7"
          title="In vs out, month by month"
          subtitle={inProgress ? `${monthShort(w.to)} is still in progress` : "Both months in full"}
          legend={
            <Legend
              items={[
                { label: "Money in", color: "var(--flow-in)" },
                { label: "Money out", color: "var(--flow-out)" },
              ]}
            />
          }
          table={{
            caption: "Monthly income and spending",
            columns: ["Month", "In", "Out", "Kept"],
            rows: flows.map((f, i) => [labels[i]!, money0(f.income), money0(f.spending), signedMoney0(f.net)]),
          }}
        >
          <BarChart
            labels={labels}
            axisLabels={axis}
            series={[
              { id: "in", label: "Money in", color: "var(--flow-in)", values: flows.map((f) => f.income) },
              { id: "out", label: "Money out", color: "var(--flow-out)", values: flows.map((f) => f.spending) },
            ]}
            partial={partial}
            height={260}
            ariaLabel="Monthly money in and money out"
          />
        </ChartCard>

        <ChartCard
          className="lg:col-span-5"
          title="What you kept each month"
          subtitle="Above the line you saved; below, you dipped into savings"
          table={{
            caption: "Net kept per month",
            columns: ["Month", "Kept"],
            rows: flows.map((f, i) => [labels[i]!, signedMoney0(f.net)]),
          }}
        >
          <BarChart
            labels={labels}
            axisLabels={axis}
            series={[{ id: "net", label: "Kept", color: "var(--flow-in)", negativeColor: "var(--flow-out)", values: flows.map((f) => f.net) }]}
            partial={partial}
            height={260}
            ariaLabel="Net amount kept each month"
          />
        </ChartCard>
      </div>

      <ChartCard
        title="Savings rate"
        subtitle="The share of each month's income you kept — 20% is a common target"
        legend={
          <Legend
            items={[
              { label: "Savings rate", color: "var(--c-4)", kind: "line" },
              { label: "20% target", color: "var(--c-other)", kind: "line" },
            ]}
          />
        }
        table={{
          caption: "Savings rate by month",
          columns: ["Month", "Savings rate"],
          rows: flows.map((f, i) => [labels[i]!, f.savingsRate === null ? "—" : percent(f.savingsRate)]),
        }}
      >
        <TimeSeriesChart
          labels={labels}
          axisLabels={axis}
          series={[
            { id: "target", label: "20% target", color: "var(--c-other)", values: flows.map(() => 0.2), muted: true },
            { id: "rate", label: "Savings rate", color: "var(--c-4)", values: flows.map((f) => f.savingsRate), area: true },
          ]}
          format="percent"
          axisFormat="percent"
          include={0}
          height={220}
          ariaLabel="Savings rate by month against a 20% target"
        />
      </ChartCard>
    </div>
  );
}
