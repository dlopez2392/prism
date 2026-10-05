// src/app/net-worth/page.tsx — everything you own, minus
// everything you owe.
//
// Hero (the one --gradient-prism card): net worth now. Then the 12-month
// story (assets and debts on one axis — never a second one), every account
// with its own trend, what the investments are made of, credit health, and,
// when anything is owed on a card or a loan, a plan for paying it off.

import type { Metadata } from "next";
import { Gauge, Landmark } from "lucide-react";
import { ChartCard } from "@/components/chart-card";
import { Legend } from "@/components/charts/core";
import { ScoreGauge } from "@/components/charts/radial";
import { Sparkline } from "@/components/charts/sparkline";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { TreemapChart } from "@/components/charts/treemap-chart";
import { DebtPlanner } from "@/components/debt-planner";
import { AddManualItem, AddWhatYouOwn, ManualItemRow } from "@/components/manual-item-editor";
import { CountedAccounts, type CountedAccount } from "@/components/counted-accounts";
import { homeValuesEnabled } from "@/lib/homevalue/rentcast";
import { Card, CardHeader, Change, EmptyState, PageHeader, StatusPill, type Status } from "@/components/ui";
import { usualMonthlyKept } from "@/lib/finance/afford";
import { monthlyCashFlow } from "@/lib/finance/cashflow";
import { slotColor } from "@/lib/finance/categories";
import { lastMonths } from "@/lib/finance/dates";
import { termsLine } from "@/lib/finance/debts";
import { capitalized, money0, monthShort, monthYear, percent, signedMoney0 } from "@/lib/finance/format";
import { MANUAL_INSTITUTION_ID, MANUAL_INSTITUTION_NAME } from "@/lib/finance/manual";
import { allocation, ASSET_CLASS_SLOT, assetClassLabel, groupAccounts, netWorthSeries } from "@/lib/finance/networth";
import { debtAccounts } from "@/lib/finance/payoff";
import type { CreditScore } from "@/lib/finance/types";
import { getFinance } from "@/lib/server/finance";
import { getT } from "@/lib/i18n/server";
import { msg, type T } from "@/lib/i18n/t";
import { WALLETS_INSTITUTION_ID } from "@/lib/crypto/wallets";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Net worth") };
}

const RATING: Record<string, Status> = { excellent: "good", good: "good", fair: "warn", poor: "crit" };

/** What each credit factor's rating says, in English: shown with t(). */
const RATING_LABEL: Record<CreditScore["factors"][number]["rating"], string> = {
  excellent: msg("Excellent"),
  good: msg("Good"),
  fair: msg("Fair"),
  poor: msg("Poor"),
};

/** "12 accounts across 4 institutions", one and many said apart. */
function accountsAcross(n: number, m: number, t: T): string {
  if (n === 1) return m === 1 ? t("1 account across 1 institution") : t("1 account across {m} institutions", { m });
  return m === 1 ? t("{n} accounts across 1 institution", { n }) : t("{n} accounts across {m} institutions", { n, m });
}

export default async function NetWorthPage() {
  const [data, t] = await Promise.all([getFinance(), getT()]);
  const { locale } = t;
  const series = netWorthSeries(data.accounts, data.today);
  // What a person adds by hand lives in their account; the example household's is only for show.
  // In the Household view, everyone's things are shown, and each person edits their own from Me.
  const canAdd = data.account !== null && data.view === "me";
  // RentCast can keep a home's value up to date once the operator has switched it on.
  const estimates = homeValuesEnabled();
  const editable = new Map(canAdd && data.source !== "demo" ? data.manual.map((i) => [`manual-${i.id}`, i]) : []);
  // The way in to a home, a car or a loan: high on the page until the person has added one, then below their accounts.
  const addCard = canAdd ? <AddWhatYouOwn estimates={estimates} added={editable.size} /> : null;
  const institutions = new Map(data.institutions.map((i) => [i.id, i.name]));
  // A bank's name is its own; "Added by you" is Prism's, in the person's language.
  const institutionName = (id: string) => {
    const name = institutions.get(id);
    return name === undefined ? "—" : id === MANUAL_INSTITUTION_ID ? t(MANUAL_INSTITUTION_NAME) : id === WALLETS_INSTITUTION_ID ? t("Your wallets") : name;
  };
  // Which of their own accounts count in their totals: every one they have, those left out included, so any can come back.
  const hiddenAccounts = data.hiddenAccounts ?? [];
  const counted: CountedAccount[] = [...data.accounts.map((a) => ({ a, counted: true })), ...hiddenAccounts.map((a) => ({ a, counted: false }))].map(({ a, counted }) => ({
    id: a.id,
    name: a.name,
    where: `${institutionName(a.institutionId)}${a.mask ? ` ·· ${a.mask}` : ""}`,
    balance: a.balance,
    counted,
  }));
  const choose = canAdd && data.source !== "demo" && counted.length > 0 ? <CountedAccounts accounts={counted} /> : null;

  if (data.accounts.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title={t("Net worth")} subtitle={t("Everything you own, minus everything you owe.")} />
        <Card>
          <EmptyState
            icon={Landmark}
            title={hiddenAccounts.length ? t("Every account is left out of your totals") : t("Your whole picture, in one number")}
            body={
              hiddenAccounts.length
                ? t("Count one again below and your net worth comes back, month by month.")
                : canAdd
                  ? t("Link your accounts, or add your home, a car or a loan below, and this becomes your net worth, month by month.")
                  : t("Link your accounts and this becomes your net worth, month by month.")
            }
          />
          {choose ? <div className="px-5 pb-5 sm:px-6 sm:pb-6">{choose}</div> : null}
        </Card>
        {addCard}
      </div>
    );
  }

  const now = series.at(-1)!;
  const prev = series.at(-2) ?? now;
  const first = series[0]!;
  // Each month on its own (a table's row, a tooltip): in Spanish with a capital.
  const labels = series.map((p) => capitalized(monthYear(`${p.month}-01`, locale)));
  const groups = groupAccounts(data.accounts);
  const alloc = allocation(data.holdings);
  const invested = alloc.reduce((s, x) => s + x.value, 0);
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
        group: assetClassLabel(h.assetClass, t),
      };
    });
  const credit = data.credit;
  const household = data.view === "household";
  // Every card and loan with something owed, for the payoff plan; and what's usually kept a month, as a guide for the extra.
  const owed = debtAccounts(data.accounts, data.transactions, data.today);
  const firstRecord = data.transactions.reduce<string | null>((min, txn) => (txn.date <= data.today && (min === null || txn.date < min) ? txn.date : min), null);
  const kept = usualMonthlyKept(monthlyCashFlow(data.transactions, lastMonths(data.today, 13)), data.today, firstRecord);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("Net worth")}
        subtitle={household ? t("Everything your household shares: what it owns, minus what it owes — and how it's moving.") : t("Everything you own, minus everything you owe — and how it's moving.")}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card hero className="flex flex-col justify-between p-5 sm:p-6 lg:col-span-4">
          <div>
            <div className="text-sm font-semibold text-[var(--on-hero-soft)]">{t("Net worth today")}</div>
            <div className="mt-1 text-[48px] font-extrabold leading-none tracking-tight">{money0(now.net)}</div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {series.length >= 2 ? (
                <>
                  <Change onHero t={t} text={signedMoney0(now.net - prev.net)} up={now.net >= prev.net} suffix={t("this month")} />
                  <Change
                    onHero
                    t={t}
                    text={signedMoney0(now.net - first.net)}
                    up={now.net >= first.net}
                    suffix={series.length >= 13 ? t("in a year") : series.length === 2 ? t("in 1 month") : t("in {n} months", { n: series.length - 1 })}
                  />
                </>
              ) : (
                <span className="text-xs font-semibold text-[var(--on-hero-soft)]">{t("Tracking from today — the change shows after your first month")}</span>
              )}
            </div>
          </div>
          {series.length >= 2 ? (
            <div className="mt-6" aria-hidden>
              <div className="mb-2 text-xs font-semibold text-[var(--on-hero-soft)]">{t("Change each month")}</div>
              <MonthlyChange values={series.slice(1).map((p, i) => p.net - series[i]!.net)} />
            </div>
          ) : null}
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-ctl bg-[var(--on-hero-faint)] p-3">
              <dt className="text-xs text-[var(--on-hero-soft)]">{household ? t("Together you own") : t("You own")}</dt>
              <dd className="mt-0.5 text-lg font-bold">{money0(now.assets)}</dd>
            </div>
            <div className="rounded-ctl bg-[var(--on-hero-faint)] p-3">
              <dt className="text-xs text-[var(--on-hero-soft)]">{household ? t("Together you owe") : t("You owe")}</dt>
              <dd className="mt-0.5 text-lg font-bold">{money0(now.debts)}</dd>
            </div>
          </dl>
        </Card>

        <ChartCard
          className="lg:col-span-8"
          title={t("The last 12 months")}
          subtitle={t("What you own and what you owe, on one scale — the gap between them is your net worth")}
          legend={
            <Legend
              items={[
                { label: t("Net worth"), color: "var(--accent)", kind: "line" },
                { label: t("You own"), color: "var(--flow-in)", kind: "line" },
                { label: t("You owe"), color: "var(--flow-out)", kind: "line" },
              ]}
            />
          }
          table={{
            caption: t("Month-end assets, debts and net worth"),
            columns: [t("Month"), t("Own"), t("Owe"), t("Net worth")],
            rows: series.map((p, i) => [labels[i]!, money0(p.assets), money0(p.debts), money0(p.net)]),
          }}
        >
          <TimeSeriesChart
            labels={labels}
            axisLabels={series.map((p) => capitalized(monthShort(`${p.month}-01`, locale)))}
            series={[
              { id: "assets", label: t("You own"), color: "var(--flow-in)", values: series.map((p) => p.assets) },
              { id: "debts", label: t("You owe"), color: "var(--flow-out)", values: series.map((p) => p.debts) },
              { id: "net", label: t("Net worth"), color: "var(--accent)", values: series.map((p) => p.net), area: true },
            ]}
            include={0}
            height={280}
            endLabels
            ariaLabel={t("Net worth over 12 months, from {from} to {to}.", { from: money0(first.net), to: money0(now.net) })}
          />
        </ChartCard>
      </div>

      {editable.size === 0 ? addCard : null}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <Card className="p-5 sm:p-6 lg:col-span-7">
          <CardHeader
            title={t("Accounts")}
            subtitle={accountsAcross(data.accounts.length, data.institutions.length, t)}
            action={canAdd ? <AddManualItem estimates={estimates} /> : undefined}
          />
          <div className="mt-3 space-y-5">
            {groups.map((g) => (
              <section key={g.label}>
                <div className="flex items-baseline justify-between border-b border-line pb-1.5">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">{t(g.label)}</h3>
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
                    const terms = termsLine(acc, t);
                    const content = (
                      <>
                        {/* On a phone the name gets the row and may wrap; from sm up it shares it with the trend line. */}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-ink-1 [overflow-wrap:anywhere] sm:truncate">{acc.name}</div>
                          <div className="truncate text-xs text-ink-3">
                            {institutionName(acc.institutionId)}
                            {acc.mask ? ` ·· ${acc.mask}` : ""}
                            {mine
                              ? ` · ${
                                  mine.values.at(-1)!.estimated
                                    ? t("RentCast estimate {month}", { month: monthYear(`${mine.values.at(-1)!.month}-01`, locale) })
                                    : t("updated {month}", { month: monthYear(`${mine.values.at(-1)!.month}-01`, locale) })
                                }`
                              : ""}
                          </div>
                          {terms || acc.liability?.overdue ? (
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
                              {acc.liability?.overdue ? <StatusPill status="warn">{t("Overdue")}</StatusPill> : null}
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
                              <Change t={t} text={money0(Math.abs(moved))} up={moved === 0 ? null : moved > 0} goodWhenUp={!debt} suffix={acc.history.length === 2 ? t("1 mo") : t("{n} mo", { n: acc.history.length - 1 })} />
                            </div>
                          ) : null}
                        </div>
                      </>
                    );
                    return mine ? (
                      <li key={acc.id}>
                        <ManualItemRow item={mine} label={t("Edit {name}, {amount}", { name: acc.name, amount: money0(acc.balance) })} estimates={estimates} valuation={data.homeValues.find((h) => h.itemId === mine.id)}>
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
          {choose}
        </Card>

        <div className="space-y-5 lg:col-span-5">
          <ChartCard
            title={t("What your investments hold")}
            subtitle={
              invested > 0
                ? data.holdings.length === 1
                  ? t("{amount} in 1 holding — size is value, colour is type", { amount: money0(invested) })
                  : t("{amount} across {n} holdings — size is value, colour is type", { amount: money0(invested), n: data.holdings.length })
                : undefined
            }
            legend={alloc.length ? <Legend items={alloc.map((x) => ({ label: `${assetClassLabel(x.assetClass, t)} ${percent(x.share)}`, color: slotColor(ASSET_CLASS_SLOT[x.assetClass]) }))} /> : undefined}
            table={{
              caption: t("Holdings by value"),
              columns: [t("Holding"), t("Type"), t("Value"), t("Share")],
              rows: tiles.map((tile) => [`${tile.label} — ${tile.sublabel}`, tile.group, money0(tile.value), percent(tile.value / Math.max(1, invested))]),
            }}
          >
            {tiles.length ? (
              <TreemapChart tiles={tiles} height={300} ariaLabel={t("Investment holdings sized by value")} />
            ) : household ? (
              <EmptyState
                icon={Landmark}
                title={t("Holdings aren't shared yet")}
                body={t("Shared investment accounts count toward the total. What each one holds shows in its owner's own view, for now.")}
              />
            ) : (
              <EmptyState icon={Landmark} title={t("No investments linked")} body={t("Link a brokerage or retirement account and each holding becomes a tile sized by its value.")} />
            )}
          </ChartCard>

          <Card className="p-5 sm:p-6">
            <CardHeader title={t("Credit health")} subtitle={credit ? credit.provider : undefined} />
            {credit ? (
              <>
                <div className="mt-4">
                  <ScoreGauge score={credit.score} />
                </div>
                <div className="mt-2 flex items-center justify-center gap-2 text-xs text-ink-3">
                  <span>{t("12 months ago: {score}", { score: credit.history[0]! })}</span>
                  <Sparkline values={credit.history} color="var(--good)" width={72} height={22} />
                  <span className="font-semibold text-good-ink">{t("+{n} points", { n: credit.score - credit.history[0]! })}</span>
                </div>
                <ul className="mt-4 divide-y divide-[var(--line)]">
                  {credit.factors.map((f) => (
                    <li key={f.name} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ink-1">{f.name}</div>
                        <div className="truncate text-xs text-ink-3">{f.detail}</div>
                      </div>
                      <StatusPill status={RATING[f.rating] ?? "neutral"}>{t(RATING_LABEL[f.rating])}</StatusPill>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <EmptyState icon={Gauge} title={t("Credit score, coming soon")} body={t("Your score and what moves it will show here once a credit partner is connected.")} />
            )}
          </Card>
        </div>
      </div>

      {editable.size > 0 ? addCard : null}

      {owed.length ? (
        <Card className="p-5 sm:p-6">
          <CardHeader
            title={t("Paying off what you owe")}
            subtitle={t("Every debt keeps its own payment; the extra goes to one at a time, and each one paid off adds its payment to the next. Nothing you try is saved.")}
          />
          <div className="mt-3">
            <DebtPlanner debts={owed} today={data.today} kept={kept} />
          </div>
        </Card>
      ) : null}
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
