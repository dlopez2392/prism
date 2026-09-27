// apps/finance/src/app/page.tsx — Overview: the one-glance picture.
//
// Hero: net worth (the one --gradient-prism card on this screen). Then the
// four numbers a person checks most, the month's spending pace against last
// month's, where it went, how the budgets stand, what's worth knowing, and
// what's coming next.

import { Sparkles, Telescope } from "lucide-react";
import Link from "next/link";
import { InsightList, SeeAll, StatTile, TransactionRow, UpcomingList } from "@/components/blocks";
import { ChartCard } from "@/components/chart-card";
import { Legend } from "@/components/charts/core";
import { ActivityRings } from "@/components/charts/radial";
import { Sparkline } from "@/components/charts/sparkline";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { SpendingDonut } from "@/components/spending-donut";
import { Card, CardHeader, Change, EmptyState, StatusPill } from "@/components/ui";
import { categoryBreakdown, cumulativeSpend } from "@/lib/finance/cashflow";
import { CATEGORIES, categoryColor } from "@/lib/finance/categories";
import { addDays, daysInMonth } from "@/lib/finance/dates";
import { dayDate, money0, monthLong, monthShort, signedMoney0, signedPercent } from "@/lib/finance/format";
import { analyze } from "@/lib/finance/model";
import { foldSlices, greeting } from "@/lib/finance/view";
import { getFinance } from "@/lib/server/finance";

export default async function OverviewPage() {
  const data = await getFinance();
  const a = analyze(data);
  const lookup = new Map(data.transactions.map((t) => [t.id, t]));

  const nw = a.netWorth;
  const nowNet = nw.at(-1)?.net ?? 0;
  const lastMonthNet = nw.at(-2)?.net ?? nowNet;
  const yearAgoNet = nw[0]?.net ?? nowNet;

  // Spending pace: this month so far vs the whole of last month, by day.
  const thisCurve = cumulativeSpend(data.transactions, a.mtd.from, a.today);
  const lastCurve = cumulativeSpend(data.transactions, a.mtd.prevFrom);
  const days = Math.max(daysInMonth(a.mtd.from), lastCurve.length);
  const dayLabels = Array.from({ length: days }, (_, i) => `Day ${i + 1}`);
  const paceDelta = a.spentMTD - a.spentPrevSpan;

  const rows = categoryBreakdown(data.transactions, { from: a.mtd.from, to: a.today }, { from: a.mtd.prevFrom, to: a.mtd.prevTo });
  const slices = foldSlices(rows);

  const flex = a.budgets.filter((b) => ["food", "transport", "shopping", "fun"].includes(b.category));
  const recent = [...data.transactions].reverse().slice(0, 7);
  const accountName = new Map(data.accounts.map((x) => [x.id, x.name]));
  const upcoming = a.forecast ? a.forecast.events.filter((e) => e.date <= addDays(a.today, 14)) : [];
  const thisMonth = a.flows.at(-1)!;
  const savedRate = thisMonth.savingsRate;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{dayDate(a.today)}</div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-[28px]">
            {greeting(data.localHour)}, <span className="text-prism">{data.household.firstName}</span>
          </h1>
        </div>
      </div>

      {/* Row 1 — the hero and the number people actually act on. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card hero className="relative overflow-hidden p-5 sm:p-6 lg:col-span-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-[var(--on-hero-soft)]">Net worth</div>
              <div className="mt-1 text-[44px] font-extrabold leading-none tracking-tight sm:text-[56px]">{money0(nowNet)}</div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                <Change onHero text={signedMoney0(nowNet - lastMonthNet)} up={nowNet >= lastMonthNet} suffix="this month" />
                <Change onHero text={signedMoney0(nowNet - yearAgoNet)} up={nowNet >= yearAgoNet} suffix="in 12 months" />
              </div>
            </div>
            <Link href="/net-worth" className="rounded-pill bg-[var(--on-hero-faint)] px-3 py-1.5 text-xs font-bold text-[var(--on-hero)] transition-opacity duration-150 hover:opacity-80">
              Details
            </Link>
          </div>
          <div className="mt-5 -mx-1">
            <Sparkline values={nw.map((p) => p.net)} onHero fluid width={640} height={92} />
          </div>
          <div className="mt-3 flex justify-between text-[11px] font-semibold text-[var(--on-hero-soft)]">
            <span>{monthShort(nw[0]?.month ?? a.today)}</span>
            <span>
              Assets {money0(nw.at(-1)?.assets ?? 0)} · Debts {money0(nw.at(-1)?.debts ?? 0)}
            </span>
            <span>{monthShort(a.today)}</span>
          </div>
        </Card>

        <Card className="flex flex-col p-5 sm:p-6 lg:col-span-5">
          <CardHeader title="Safe to spend" subtitle={a.safe?.until ? `Until your paycheck on ${dayDate(a.safe.until)}` : "Over the next two weeks"} action={<SeeAll href="/future">Future</SeeAll>} />
          {a.safe && a.checking ? (
            <>
              <div className="mt-4 text-[44px] font-extrabold leading-none tracking-tight text-ink-1">{money0(a.safe.amount)}</div>
              <p className="mt-2 text-sm text-ink-2">
                After every bill due before then, with a {money0(a.safe.cushion)} cushion left in {a.checking.name}.
              </p>
              <SafeBar balance={a.checking.balance} committed={a.safe.committed} cushion={a.safe.cushion} safe={a.safe.amount} />
            </>
          ) : (
            <EmptyState icon={Telescope} title="Link a checking account" body="Safe-to-spend looks at your checking balance and every bill due before payday." />
          )}
        </Card>
      </div>

      {/* Row 2 — the four numbers. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        <StatTile
          label={`Spent in ${monthLong(a.today)}`}
          value={money0(a.spentMTD)}
          change={<Change text={signedMoney0(paceDelta)} up={paceDelta > 0} goodWhenUp={false} suffix={`vs ${monthShort(a.mtd.prevFrom)} so far`} />}
          spark={thisCurve}
          sparkColor="var(--c-2)"
        />
        <StatTile
          label={`Income in ${monthLong(a.today)}`}
          value={money0(a.incomeMTD)}
          spark={a.flows.map((f) => f.income)}
          sparkColor="var(--flow-in)"
          foot={<span>{monthLong(a.today)} to date</span>}
        />
        <StatTile
          label="Kept this month"
          value={money0(Math.max(0, thisMonth.net))}
          spark={a.flows.map((f) => f.net)}
          sparkColor="var(--c-4)"
          foot={<span>{savedRate !== null ? `${Math.round(savedRate * 100)}% of income` : "No income yet this month"}</span>}
        />
        <StatTile
          label="Left in budgets"
          value={money0(Math.max(0, a.budgetTotals.remaining))}
          foot={<span>of {money0(a.budgetTotals.limit)} for {monthLong(a.today)}</span>}
          change={
            a.budgetTotals.projected > a.budgetTotals.limit ? (
              <StatusPill status="warn">On pace to go over</StatusPill>
            ) : (
              <StatusPill status="good">On track</StatusPill>
            )
          }
        />
      </div>

      {/* Row 3 — pace and categories. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <ChartCard
          className="lg:col-span-7"
          title="Spending pace"
          subtitle={`${monthLong(a.today)} so far against all of ${monthLong(a.mtd.prevFrom)}`}
          legend={
            <Legend
              items={[
                { label: monthLong(a.today), color: "var(--accent)", kind: "line", value: money0(a.spentMTD) },
                { label: monthLong(a.mtd.prevFrom), color: "var(--c-other)", kind: "line", value: money0(a.spentPrevMonth) },
              ]}
            />
          }
          table={{
            caption: "Cumulative spending by day of month",
            columns: ["Day", monthLong(a.today), monthLong(a.mtd.prevFrom)],
            rows: Array.from({ length: days }, (_, i) => [
              `Day ${i + 1}`,
              thisCurve[i] !== undefined ? money0(thisCurve[i]!) : "—",
              lastCurve[i] !== undefined ? money0(lastCurve[i]!) : "—",
            ]),
          }}
        >
          <TimeSeriesChart
            labels={dayLabels}
            axisLabels={dayLabels.map((_, i) => String(i + 1))}
            series={[
              { id: "last", label: monthLong(a.mtd.prevFrom), color: "var(--c-other)", values: lastCurve, muted: true },
              { id: "this", label: monthLong(a.today), color: "var(--accent)", values: thisCurve, area: true },
            ]}
            include={0}
            height={250}
            ariaLabel={`Cumulative spending: ${money0(a.spentMTD)} so far in ${monthLong(a.today)}, against ${money0(a.spentPrevSpan)} by the same day last month.`}
          />
        </ChartCard>

        <ChartCard
          className="lg:col-span-5"
          title="Where it went"
          subtitle={`${monthLong(a.today)} so far, by category`}
          table={{
            caption: "Spending by category this month",
            columns: ["Category", "Spent", "Share", `vs ${monthShort(a.mtd.prevFrom)}`],
            rows: rows.map((r) => [
              CATEGORIES[r.category].label,
              money0(r.amount),
              `${Math.round(r.share * 100)}%`,
              r.change === null ? "new" : signedPercent(r.change),
            ]),
          }}
        >
          {slices.length ? (
            <SpendingDonut slices={slices} total={a.spentMTD} label="Spent" size={188} />
          ) : (
            <EmptyState icon={Sparkles} title="Nothing spent yet this month" body="As purchases land, each category gets its own slice here." />
          )}
        </ChartCard>
      </div>

      {/* Rows 4–5 — two columns that each stack, so neither leaves a hole. */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-5">
          <Card className="p-5 sm:p-6">
            <CardHeader title="Everyday budgets" subtitle="Each ring fills as you spend" action={<SeeAll href="/budgets">All budgets</SeeAll>} />
            {flex.length ? (
              <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row">
                <ActivityRings
                  size={176}
                  stroke={15}
                  rings={flex.map((b) => ({ id: b.category, label: CATEGORIES[b.category].label, ratio: b.used, color: categoryColor(b.category) }))}
                  ariaLabel={flex.map((b) => `${CATEGORIES[b.category].label} ${Math.round(b.used * 100)}% used`).join(", ")}
                />
                <ul className="w-full flex-1 space-y-2.5">
                  {flex.map((b) => (
                    <li key={b.category} className="flex items-center gap-2.5">
                      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: categoryColor(b.category) }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-ink-1">{CATEGORIES[b.category].label}</div>
                        <div className="num text-xs text-ink-3">
                          {money0(b.spent)} of {money0(b.limit)}
                        </div>
                      </div>
                      {b.state === "over" ? (
                        <StatusPill status="crit">Over</StatusPill>
                      ) : b.state === "at_risk" ? (
                        <StatusPill status="warn">Watch</StatusPill>
                      ) : (
                        <StatusPill status="good">{Math.round(b.used * 100)}%</StatusPill>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <EmptyState icon={Sparkles} title="No budgets yet" body="Budgets appear here as rings that fill as you spend." />
            )}
          </Card>

          <Card className="p-5 sm:p-6">
            <CardHeader title="Coming up" subtitle="The next two weeks in checking" action={<SeeAll href="/future">Forecast</SeeAll>} />
            <div className="mt-2">
              <UpcomingList events={upcoming} limit={6} />
            </div>
          </Card>
        </div>
        <div className="space-y-5 lg:col-span-7">
          <Card className="p-5 sm:p-6">
            <CardHeader title="Worth knowing" subtitle="Worked out from your own transactions — tap to see which" />
            <div className="mt-4">
              {a.insights.length ? (
                <InsightList insights={a.insights} lookup={lookup} limit={4} />
              ) : (
                <EmptyState icon={Sparkles} title="Nothing to flag" body="Price rises, budgets on the edge and wins worth celebrating show up here." />
              )}
            </div>
          </Card>
          <Card className="p-5 sm:p-6">
            <CardHeader title="Recent activity" action={<SeeAll href="/spending#transactions">All transactions</SeeAll>} />
            {recent.length ? (
              <ul className="mt-2 divide-y divide-[var(--line)]">
                {recent.map((t) => (
                  <TransactionRow key={t.id} t={t} accountName={accountName.get(t.accountId)} />
                ))}
              </ul>
            ) : (
              <EmptyState icon={Sparkles} title="No transactions yet" body="Once a bank is linked, every purchase lands here within minutes." />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Where the checking balance is spoken for, as one bar: bills, cushion, safe. */
function SafeBar({ balance, committed, cushion, safe }: { balance: number; committed: number; cushion: number; safe: number }) {
  const total = Math.max(balance, committed + cushion + safe, 1);
  const parts = [
    { label: "Bills before payday", value: Math.min(committed, balance), color: "var(--flow-out)" },
    { label: "Cushion", value: Math.min(cushion, Math.max(0, balance - committed)), color: "var(--c-other)" },
    { label: "Safe to spend", value: safe, color: "var(--flow-in)" },
  ];
  return (
    <div className="mt-auto pt-5">
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-pill" role="img" aria-label={parts.map((p) => `${p.label} ${money0(p.value)}`).join(", ")}>
        {parts.map((p) =>
          p.value > 0 ? <div key={p.label} className="h-full first:rounded-l-pill last:rounded-r-pill" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} /> : null,
        )}
      </div>
      <Legend className="mt-3" items={parts.map((p) => ({ label: p.label, color: p.color, value: money0(p.value) }))} />
    </div>
  );
}
