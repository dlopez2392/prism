// src/app/page.tsx — Overview: the one-glance picture.
//
// Hero: net worth (the one --gradient-prism card on this screen). Then the
// four numbers a person checks most, the month's spending pace against last
// month's, where it went, how the budgets stand, what's worth knowing, and
// what's coming next.

import { Plus, Sparkles, Telescope } from "lucide-react";
import Link from "next/link";
import { HeadsUp, InsightList, SeeAll, StatTile, TransactionRow, UpcomingList } from "@/components/blocks";
import { alertsFor } from "@/lib/finance/alerts";
import { ChartCard } from "@/components/chart-card";
import { Legend } from "@/components/charts/core";
import { ActivityRings } from "@/components/charts/radial";
import { Sparkline } from "@/components/charts/sparkline";
import { SpendingDonut } from "@/components/spending-donut";
import { SpendingPace } from "@/components/spending-pace";
import { Card, CardHeader, Change, EmptyState, StatusPill } from "@/components/ui";
import { categoryBreakdown, cumulativeSpend } from "@/lib/finance/cashflow";
import { categoryColor, categoryLabel } from "@/lib/finance/categories";
import { addDays } from "@/lib/finance/dates";
import { capitalized, dayDate, money0, monthLong, monthShort, signedMoney0, signedPercent } from "@/lib/finance/format";
import { analyze } from "@/lib/finance/model";
import { foldSlices, greeting, ledgerHash } from "@/lib/finance/view";
import type { CategoryId } from "@/lib/finance/types";
import { ADD_CARD_LINK } from "@/lib/finance/manual";
import { getFinance } from "@/lib/server/finance";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/t";

export default async function OverviewPage() {
  const [data, t] = await Promise.all([getFinance(), getT()]);
  const { locale } = t;
  const a = analyze(data, t);
  const month = monthLong(a.today, locale);
  // What everyone shared, paced against the household's own budgets.
  const household = data.view === "household";
  // A person's own view with nothing a bank can't report yet: no home, car or other thing added by hand, and no property a bank sent.
  const addHome = data.account !== null && !household && data.manual.length === 0 && (data.source === "demo" || !data.accounts.some((acc) => acc.kind === "property"));
  const lookup = new Map(data.transactions.map((t) => [t.id, t]));

  const nw = a.netWorth;
  const nowNet = nw.at(-1)?.net ?? 0;
  const lastMonthNet = nw.at(-2)?.net ?? nowNet;
  const yearAgoNet = nw[0]?.net ?? nowNet;

  // This month so far, added up day by day: the Spent tile's sparkline.
  const thisCurve = cumulativeSpend(data.transactions, a.mtd.from, a.today);
  const paceDelta = a.spentMTD - a.spentPrevSpan;

  const rows = categoryBreakdown(data.transactions, { from: a.mtd.from, to: a.today }, { from: a.mtd.prevFrom, to: a.mtd.prevTo });
  const slices = foldSlices(rows, t);
  // Every category opens this month's transactions in it; "Everything else", all of them.
  const thisMonthIn = (category: CategoryId) => `/spending?range=1${ledgerHash({ category })}`;
  const sliceHrefs = Object.fromEntries(slices.map((s) => [s.id, s.id === "rest" ? "/spending?range=1#transactions" : thisMonthIn(s.id as CategoryId)]));

  const flex = a.budgets.filter((b) => ["food", "transport", "shopping", "fun"].includes(b.category));
  const recent = [...data.transactions].reverse().slice(0, 7);
  const accountName = new Map([...data.accounts, ...(data.hiddenAccounts ?? [])].map((x) => [x.id, x.name]));
  const upcoming = a.forecast ? a.forecast.events.filter((e) => e.date <= addDays(a.today, 14)) : [];
  const thisMonth = a.flows.at(-1)!;
  const savedRate = thisMonth.savingsRate;
  // Only what's the person's own to act on: another member's bank isn't theirs to sign in to. A price rise is an insight below.
  const headsUp = household ? [] : alertsFor(a, t).filter((x) => x.urgent);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{dayDate(a.today, locale)}</div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-[28px]">
            {greeting(data.localHour, t)}, <span className="text-prism">{data.household.firstName}</span>
          </h1>
        </div>
      </div>

      <HeadsUp alerts={headsUp} t={t} />

      {/* Row 1 — the hero and the number people actually act on. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card hero className="relative overflow-hidden p-5 sm:p-6 lg:col-span-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-[var(--on-hero-soft)]">{t("Net worth")}</div>
              <div className="mt-1 text-[44px] font-extrabold leading-none tracking-tight sm:text-[56px]">{money0(nowNet)}</div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                {nw.length >= 2 ? (
                  <>
                    <Change onHero t={t} text={signedMoney0(nowNet - lastMonthNet)} up={nowNet >= lastMonthNet} suffix={t("this month")} />
                    <Change
                      onHero
                      t={t}
                      text={signedMoney0(nowNet - yearAgoNet)}
                      up={nowNet >= yearAgoNet}
                      suffix={nw.length >= 13 ? t("in 12 months") : nw.length === 2 ? t("in 1 month") : t("in {n} months", { n: nw.length - 1 })}
                    />
                  </>
                ) : (
                  // A just-linked account has one month-end: a "+$0" arrow would be a claim, not a fact.
                  <span className="text-xs font-semibold text-[var(--on-hero-soft)]">{t("Tracking from today — the change shows after your first month")}</span>
                )}
              </div>
              {/* Until a home, a car or anything else a bank can't see is in, say where it goes: banks never report a house. */}
              {addHome ? (
                <Link
                  href={ADD_CARD_LINK}
                  className="mt-3 inline-flex items-center gap-1 rounded-pill bg-[var(--on-hero-faint)] px-3 py-1.5 text-xs font-bold text-[var(--on-hero)] transition-opacity duration-150 hover:opacity-80"
                >
                  <Plus aria-hidden className="size-3.5" strokeWidth={2.5} />
                  {t("Add your home or car")}
                </Link>
              ) : null}
            </div>
            <Link href="/net-worth" className="rounded-pill bg-[var(--on-hero-faint)] px-3 py-1.5 text-xs font-bold text-[var(--on-hero)] transition-opacity duration-150 hover:opacity-80">
              {t("Details")}
            </Link>
          </div>
          <div className="mt-5 -mx-1">
            <Sparkline values={nw.map((p) => p.net)} onHero fluid width={640} height={92} />
          </div>
          <div className="mt-3 flex justify-between text-[11px] font-semibold text-[var(--on-hero-soft)]">
            <span>{capitalized(monthShort(nw[0]?.month ?? a.today, locale))}</span>
            <span>{t("Assets {assets} · Debts {debts}", { assets: money0(nw.at(-1)?.assets ?? 0), debts: money0(nw.at(-1)?.debts ?? 0) })}</span>
            <span>{capitalized(monthShort(a.today, locale))}</span>
          </div>
        </Card>

        <Card className="flex flex-col p-5 sm:p-6 lg:col-span-5">
          <CardHeader
            title={t("Safe to spend")}
            subtitle={a.safe?.until ? t("Until your paycheck on {date}", { date: dayDate(a.safe.until, locale) }) : t("Over the next two weeks")}
            action={<SeeAll href="/future">{t("Future")}</SeeAll>}
          />
          {a.safe && a.checking ? (
            <>
              <div className="mt-4 text-[44px] font-extrabold leading-none tracking-tight text-ink-1">{money0(a.safe.amount)}</div>
              <p className="mt-2 text-sm text-ink-2">{t("After every bill due before then, with a {cushion} cushion left in {account}.", { cushion: money0(a.safe.cushion), account: a.checking.name })}</p>
              <SafeBar balance={a.checking.balance} committed={a.safe.committed} cushion={a.safe.cushion} safe={a.safe.amount} t={t} />
            </>
          ) : (
            <EmptyState icon={Telescope} title={t("Link a checking account")} body={t("Safe-to-spend looks at your checking balance and every bill due before payday.")} />
          )}
        </Card>
      </div>

      {/* Row 2 — the four numbers. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        <StatTile
          label={t("Spent in {month}", { month })}
          value={money0(a.spentMTD)}
          change={<Change t={t} text={signedMoney0(paceDelta)} up={paceDelta > 0} goodWhenUp={false} suffix={t("vs {month} so far", { month: monthShort(a.mtd.prevFrom, locale) })} />}
          spark={thisCurve}
          sparkColor="var(--c-2)"
        />
        <StatTile
          label={t("Income in {month}", { month })}
          value={money0(a.incomeMTD)}
          spark={a.flows.map((f) => f.income)}
          sparkColor="var(--flow-in)"
          foot={<span>{t("{month} to date", { month })}</span>}
        />
        <StatTile
          label={t("Kept this month")}
          value={money0(Math.max(0, thisMonth.net))}
          spark={a.flows.map((f) => f.net)}
          sparkColor="var(--c-4)"
          foot={<span>{savedRate !== null ? t("{pct}% of income", { pct: Math.round(savedRate * 100) }) : t("No income yet this month")}</span>}
        />
        <StatTile
          label={household ? t("Left in household budgets") : t("Left in budgets")}
          value={money0(Math.max(0, a.budgetTotals.remaining))}
          foot={
            a.budgetTotals.limit > 0 ? (
              <span>{t("of {limit} for {month}", { limit: money0(a.budgetTotals.limit), month })}</span>
            ) : (
              <Link href="/budgets" className="font-semibold text-accent-ink hover:underline">
                {t("Set a budget")}
              </Link>
            )
          }
          change={
            a.budgetTotals.limit === 0 ? (
              <StatusPill status="neutral">{t("No budgets yet")}</StatusPill>
            ) : a.budgetTotals.projected > a.budgetTotals.limit ? (
              <StatusPill status="warn">{t("On pace to go over")}</StatusPill>
            ) : (
              <StatusPill status="good">{t("On track")}</StatusPill>
            )
          }
        />
      </div>

      {/* Row 3 — pace and categories. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <SpendingPace className="lg:col-span-7" transactions={data.transactions} from={a.mtd.from} to={a.today} t={t} />

        <ChartCard
          className="lg:col-span-5"
          title={t("Where it went")}
          subtitle={t("{month} so far, by category", { month })}
          table={{
            caption: t("Spending by category this month"),
            columns: [t("Category"), t("Spent"), t("Share"), t("vs {month}", { month: monthShort(a.mtd.prevFrom, locale) })],
            rows: rows.map((r) => [categoryLabel(r.category, t), money0(r.amount), `${Math.round(r.share * 100)}%`, r.change === null ? t("new") : signedPercent(r.change)]),
          }}
        >
          {slices.length ? (
            <SpendingDonut slices={slices} total={a.spentMTD} label={t("Spent")} size={188} hrefs={sliceHrefs} />
          ) : (
            <EmptyState icon={Sparkles} title={t("Nothing spent yet this month")} body={t("As purchases land, each category gets its own slice here.")} />
          )}
        </ChartCard>
      </div>

      {/* Rows 4–5 — two columns that each stack, so neither leaves a hole. */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-5">
          <Card className="p-5 sm:p-6">
            <CardHeader
              title={household ? t("Household budgets") : t("Everyday budgets")}
              subtitle={household ? t("Each ring fills as the household spends") : t("Each ring fills as you spend")}
              action={<SeeAll href="/budgets">{t("All budgets")}</SeeAll>}
            />
            {flex.length ? (
              // Side by side only when the card is wide enough for every name and amount on one line.
              <div className="@container mt-4">
                <div className="flex flex-col items-center gap-5 @md:flex-row">
                  <ActivityRings
                    size={176}
                    stroke={15}
                    rings={flex.map((b) => ({ id: b.category, label: categoryLabel(b.category, t), ratio: b.used, color: categoryColor(b.category) }))}
                    ariaLabel={flex.map((b) => t("{category} {pct}% used", { category: categoryLabel(b.category, t), pct: Math.round(b.used * 100) })).join(", ")}
                  />
                  <ul className="w-full flex-1 space-y-0.5">
                    {flex.map((b) => (
                      <li key={b.category}>
                        {/* The whole row opens this month's transactions in the category. */}
                        <Link href={thisMonthIn(b.category)} className="-mx-2 flex items-center gap-2.5 rounded-ctl px-2 py-1.5 transition-colors duration-150 hover:bg-surface-3">
                          <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: categoryColor(b.category) }} />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-ink-1">{categoryLabel(b.category, t)}</div>
                            <div className="num text-xs text-ink-3">{t("{spent} of {limit}", { spent: money0(b.spent), limit: money0(b.limit) })}</div>
                          </div>
                          {b.state === "over" ? (
                            <StatusPill status="crit">{t("Over")}</StatusPill>
                          ) : b.state === "at_risk" ? (
                            <StatusPill status="warn">{t("Watch")}</StatusPill>
                          ) : (
                            <StatusPill status="good">{Math.round(b.used * 100)}%</StatusPill>
                          )}
                          <span className="sr-only">: {t("see these transactions")}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : household ? (
              <EmptyState
                icon={Sparkles}
                title={t("No household budgets yet")}
                body={t("They're drafted once shared accounts have a month of spending, or set them on Budgets. Each appears here as a ring that fills as the household spends.")}
              />
            ) : (
              <EmptyState icon={Sparkles} title={t("No budgets yet")} body={t("Budgets appear here as rings that fill as you spend.")} />
            )}
          </Card>

          <Card className="p-5 sm:p-6">
            <CardHeader title={t("Coming up")} subtitle={t("The next two weeks in checking")} action={<SeeAll href="/future">{t("Forecast")}</SeeAll>} />
            <div className="mt-2">
              <UpcomingList events={upcoming} limit={6} t={t} />
            </div>
          </Card>
        </div>
        <div className="space-y-5 lg:col-span-7">
          <Card className="p-5 sm:p-6">
            <CardHeader
              title={t("Worth knowing")}
              subtitle={household ? t("Worked out from what your household shares — tap to see which") : t("Worked out from your own transactions — tap to see which")}
            />
            <div className="mt-4">
              {a.insights.length ? (
                <InsightList insights={a.insights} lookup={lookup} limit={4} t={t} />
              ) : (
                <EmptyState icon={Sparkles} title={t("Nothing to flag")} body={t("Price rises, budgets on the edge and wins worth celebrating show up here.")} />
              )}
            </div>
          </Card>
          <Card className="p-5 sm:p-6">
            <CardHeader title={t("Recent activity")} action={<SeeAll href="/spending#transactions">{t("All transactions")}</SeeAll>} />
            {recent.length ? (
              <ul className="mt-2 divide-y divide-[var(--line)]">
                {recent.map((x) => (
                  <TransactionRow key={x.id} txn={x} accountName={accountName.get(x.accountId)} t={t} />
                ))}
              </ul>
            ) : (
              <EmptyState icon={Sparkles} title={t("No transactions yet")} body={t("Once a bank is linked, every purchase lands here within minutes.")} />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Where the checking balance is spoken for, as one bar: bills, cushion, safe. */
function SafeBar({ balance, committed, cushion, safe, t }: { balance: number; committed: number; cushion: number; safe: number; t: T }) {
  const total = Math.max(balance, committed + cushion + safe, 1);
  const parts = [
    { label: t("Bills before payday"), value: Math.min(committed, balance), color: "var(--flow-out)" },
    { label: t("Cushion"), value: Math.min(cushion, Math.max(0, balance - committed)), color: "var(--c-other)" },
    { label: t("Safe to spend"), value: safe, color: "var(--flow-in)" },
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
