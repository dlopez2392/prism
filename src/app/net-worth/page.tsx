// src/app/net-worth/page.tsx — everything you own, minus
// everything you owe.
//
// Hero (the one --gradient-prism card): net worth now. Then the 12-month
// story (assets and debts on one axis — never a second one), every account
// with its own trend, what the investments are made of, and credit health.

import type { Metadata } from "next";
import { Gauge, Landmark } from "lucide-react";
import { ChartCard } from "@/components/chart-card";
import { Legend } from "@/components/charts/core";
import { ScoreGauge } from "@/components/charts/radial";
import { Sparkline } from "@/components/charts/sparkline";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { TreemapChart } from "@/components/charts/treemap-chart";
import { AddManualItem, ManualItemRow } from "@/components/manual-item-editor";
import { homeValuesEnabled } from "@/lib/homevalue/rentcast";
import { Card, CardHeader, Change, EmptyState, PageHeader, StatusPill, type Status } from "@/components/ui";
import { slotColor } from "@/lib/finance/categories";
import { termsLine } from "@/lib/finance/debts";
import { money0, monthShort, monthYear, percent, signedMoney0 } from "@/lib/finance/format";
import { allocation, ASSET_CLASS_SLOT, groupAccounts, netWorthSeries } from "@/lib/finance/networth";
import { getFinance } from "@/lib/server/finance";

export const metadata: Metadata = { title: "Net worth" };

const RATING: Record<string, Status> = { excellent: "good", good: "good", fair: "warn", poor: "crit" };

export default async function NetWorthPage() {
  const data = await getFinance();
  const series = netWorthSeries(data.accounts, data.today);
  // What a person adds by hand lives in their account; the example household's is only for show.
  // In the Household view, everyone's things are shown, and each person edits their own from Me.
  const canAdd = data.account !== null && data.view === "me";
  // RentCast can keep a home's value up to date once the operator has switched it on.
  const estimates = homeValuesEnabled();
  const editable = new Map(canAdd && data.source !== "demo" ? data.manual.map((i) => [`manual-${i.id}`, i]) : []);

  if (data.accounts.length === 0) {
    return (
      <div>
        <PageHeader title="Net worth" subtitle="Everything you own, minus everything you owe." />
        <Card>
          <EmptyState
            icon={Landmark}
            title="Your whole picture, in one number"
            body={canAdd ? "Link your accounts, or add your home, a car or a loan, and this becomes your net worth, month by month." : "Link your accounts and this becomes your net worth, month by month."}
            action={canAdd ? <AddManualItem estimates={estimates} /> : undefined}
          />
        </Card>
      </div>
    );
  }

  const now = series.at(-1)!;
  const prev = series.at(-2) ?? now;
  const first = series[0]!;
  const labels = series.map((p) => monthYear(`${p.month}-01`));
  const groups = groupAccounts(data.accounts);
  const alloc = allocation(data.holdings);
  const invested = alloc.reduce((s, x) => s + x.value, 0);
  const institution = new Map(data.institutions.map((i) => [i.id, i.name]));
  const tiles = [...data.holdings]
    .sort((a, b) => b.value - a.value)
    .map((h) => {
      const slot = ASSET_CLASS_SLOT[h.assetClass];
      return {
        id: `${h.accountId}-${h.symbol}`,
        label: h.symbol,
        sublabel: h.name,
        value: h.value,
        color: slotColor(slot),
        group: h.assetClass,
      };
    });
  const credit = data.credit;
  const household = data.view === "household";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Net worth"
        subtitle={household ? "Everything your household shares: what it owns, minus what it owes — and how it's moving." : "Everything you own, minus everything you owe — and how it's moving."}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card hero className="flex flex-col justify-between p-5 sm:p-6 lg:col-span-4">
          <div>
            <div className="text-sm font-semibold text-[var(--on-hero-soft)]">Net worth today</div>
            <div className="mt-1 text-[48px] font-extrabold leading-none tracking-tight">{money0(now.net)}</div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {series.length >= 2 ? (
                <>
                  <Change onHero text={signedMoney0(now.net - prev.net)} up={now.net >= prev.net} suffix="this month" />
                  <Change
                    onHero
                    text={signedMoney0(now.net - first.net)}
                    up={now.net >= first.net}
                    suffix={series.length >= 13 ? "in a year" : `in ${series.length - 1} ${series.length === 2 ? "month" : "months"}`}
                  />
                </>
              ) : (
                <span className="text-xs font-semibold text-[var(--on-hero-soft)]">Tracking from today — the change shows after your first month</span>
              )}
            </div>
          </div>
          {series.length >= 2 ? (
            <div className="mt-6" aria-hidden>
              <div className="mb-2 text-xs font-semibold text-[var(--on-hero-soft)]">Change each month</div>
              <MonthlyChange values={series.slice(1).map((p, i) => p.net - series[i]!.net)} />
            </div>
          ) : null}
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-ctl bg-[var(--on-hero-faint)] p-3">
              <dt className="text-xs text-[var(--on-hero-soft)]">{household ? "Together you own" : "You own"}</dt>
              <dd className="mt-0.5 text-lg font-bold">{money0(now.assets)}</dd>
            </div>
            <div className="rounded-ctl bg-[var(--on-hero-faint)] p-3">
              <dt className="text-xs text-[var(--on-hero-soft)]">{household ? "Together you owe" : "You owe"}</dt>
              <dd className="mt-0.5 text-lg font-bold">{money0(now.debts)}</dd>
            </div>
          </dl>
        </Card>

        <ChartCard
          className="lg:col-span-8"
          title="The last 12 months"
          subtitle="What you own and what you owe, on one scale — the gap between them is your net worth"
          legend={
            <Legend
              items={[
                { label: "Net worth", color: "var(--accent)", kind: "line" },
                { label: "You own", color: "var(--flow-in)", kind: "line" },
                { label: "You owe", color: "var(--flow-out)", kind: "line" },
              ]}
            />
          }
          table={{
            caption: "Month-end assets, debts and net worth",
            columns: ["Month", "Own", "Owe", "Net worth"],
            rows: series.map((p, i) => [labels[i]!, money0(p.assets), money0(p.debts), money0(p.net)]),
          }}
        >
          <TimeSeriesChart
            labels={labels}
            axisLabels={series.map((p) => monthShort(`${p.month}-01`))}
            series={[
              { id: "assets", label: "You own", color: "var(--flow-in)", values: series.map((p) => p.assets) },
              { id: "debts", label: "You owe", color: "var(--flow-out)", values: series.map((p) => p.debts) },
              { id: "net", label: "Net worth", color: "var(--accent)", values: series.map((p) => p.net), area: true },
            ]}
            include={0}
            height={280}
            endLabels
            ariaLabel={`Net worth over 12 months, from ${money0(first.net)} to ${money0(now.net)}.`}
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <Card className="p-5 sm:p-6 lg:col-span-7">
          <CardHeader
            title="Accounts"
            subtitle={`${data.accounts.length} ${data.accounts.length === 1 ? "account" : "accounts"} across ${data.institutions.length} ${data.institutions.length === 1 ? "institution" : "institutions"}`}
            action={canAdd ? <AddManualItem estimates={estimates} /> : undefined}
          />
          <div className="mt-3 space-y-5">
            {groups.map((g) => (
              <section key={g.label}>
                <div className="flex items-baseline justify-between border-b border-line pb-1.5">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">{g.label}</h3>
                  <span className="num text-sm font-bold text-ink-1">{money0(g.total)}</span>
                </div>
                <ul>
                  {g.accounts.map((acc) => {
                    const up = acc.history.at(-1)! >= acc.history[0]!;
                    // On a debt, what moves is how much is owed, and less is better.
                    const debt = acc.balance < 0;
                    const moved = acc.history.length > 1 ? (debt ? Math.abs(acc.history.at(-1)!) - Math.abs(acc.history[0]!) : acc.history.at(-1)! - acc.history[0]!) : null;
                    const mine = editable.get(acc.id);
                    // A card's or a loan's own terms, when the lender sends them: when it's due, the minimum and the rate.
                    const terms = termsLine(acc);
                    const content = (
                      <>
                        {/* On a phone the name gets the row and may wrap; from sm up it shares it with the trend line. */}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-ink-1 [overflow-wrap:anywhere] sm:truncate">{acc.name}</div>
                          <div className="truncate text-xs text-ink-3">
                            {institution.get(acc.institutionId) ?? "—"}
                            {acc.mask ? ` ·· ${acc.mask}` : ""}
                            {mine ? ` · ${mine.values.at(-1)!.estimated ? "RentCast estimate" : "updated"} ${monthYear(`${mine.values.at(-1)!.month}-01`)}` : ""}
                          </div>
                          {terms || acc.liability?.overdue ? (
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
                              {acc.liability?.overdue ? <StatusPill status="warn">Overdue</StatusPill> : null}
                              {terms ? <span className="num">{terms}</span> : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="hidden shrink-0 sm:block">
                          <Sparkline values={acc.history} color={acc.balance < 0 ? "var(--flow-out)" : up ? "var(--flow-in)" : "var(--c-other)"} width={84} height={28} />
                        </div>
                        <div className="shrink-0 text-right sm:w-28">
                          <div className="num text-sm font-bold text-ink-1">{money0(acc.balance)}</div>
                          {/* The trend line's job on a phone: the balance keeps its context (DESIGN.md rule 1). */}
                          {moved !== null ? (
                            <div className="sm:hidden">
                              <Change text={money0(Math.abs(moved))} up={moved === 0 ? null : moved > 0} goodWhenUp={!debt} suffix={`${acc.history.length - 1} mo`} />
                            </div>
                          ) : null}
                        </div>
                      </>
                    );
                    return mine ? (
                      <li key={acc.id}>
                        <ManualItemRow item={mine} label={`Edit ${acc.name}, ${money0(acc.balance)}`} estimates={estimates} valuation={data.homeValues.find((h) => h.itemId === mine.id)}>
                          {content}
                        </ManualItemRow>
                      </li>
                    ) : (
                      <li key={acc.id} className="flex items-center gap-3 py-2.5">
                        {content}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </Card>

        <div className="space-y-5 lg:col-span-5">
          <ChartCard
            title="What your investments hold"
            subtitle={invested > 0 ? `${money0(invested)} across ${data.holdings.length} holdings — size is value, colour is type` : undefined}
            legend={alloc.length ? <Legend items={alloc.map((x) => ({ label: `${x.assetClass} ${percent(x.share)}`, color: slotColor(ASSET_CLASS_SLOT[x.assetClass]) }))} /> : undefined}
            table={{
              caption: "Holdings by value",
              columns: ["Holding", "Type", "Value", "Share"],
              rows: tiles.map((t) => [`${t.label} — ${t.sublabel}`, t.group, money0(t.value), percent(t.value / Math.max(1, invested))]),
            }}
          >
            {tiles.length ? (
              <TreemapChart tiles={tiles} height={300} ariaLabel="Investment holdings sized by value" />
            ) : household ? (
              <EmptyState icon={Landmark} title="Holdings aren't shared yet" body="Shared investment accounts count toward the total. What each one holds shows in its owner's own view, for now." />
            ) : (
              <EmptyState icon={Landmark} title="No investments linked" body="Link a brokerage or retirement account and each holding becomes a tile sized by its value." />
            )}
          </ChartCard>

          <Card className="p-5 sm:p-6">
            <CardHeader title="Credit health" subtitle={credit ? credit.provider : undefined} />
            {credit ? (
              <>
                <div className="mt-4">
                  <ScoreGauge score={credit.score} />
                </div>
                <div className="mt-2 flex items-center justify-center gap-2 text-xs text-ink-3">
                  <span>12 months ago: {credit.history[0]}</span>
                  <Sparkline values={credit.history} color="var(--good)" width={72} height={22} />
                  <span className="font-semibold text-good-ink">+{credit.score - credit.history[0]!} points</span>
                </div>
                <ul className="mt-4 divide-y divide-[var(--line)]">
                  {credit.factors.map((f) => (
                    <li key={f.name} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ink-1">{f.name}</div>
                        <div className="truncate text-xs text-ink-3">{f.detail}</div>
                      </div>
                      <StatusPill status={RATING[f.rating] ?? "neutral"}>{f.rating[0]!.toUpperCase() + f.rating.slice(1)}</StatusPill>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <EmptyState icon={Gauge} title="Credit score, coming soon" body="Your score and what moves it will show here once a credit partner is connected." />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Decorative month-over-month bars for the hero; the chart's table has the numbers. */
function MonthlyChange({ values }: { values: number[] }) {
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  return (
    <div className="flex h-20 items-center gap-1">
      {values.map((v, i) => (
        <div key={i} className="flex h-full flex-1 flex-col justify-center">
          <div className="flex h-1/2 items-end">
            {v > 0 ? <div className="w-full rounded-t-[4px] bg-[var(--on-hero)]" style={{ height: `${(v / max) * 100}%` }} /> : null}
          </div>
          <div className="flex h-1/2 items-start">
            {v < 0 ? <div className="w-full rounded-b-[4px] bg-[var(--on-hero-soft)] opacity-60" style={{ height: `${(-v / max) * 100}%` }} /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
