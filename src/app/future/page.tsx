// src/app/future/page.tsx — the forward view.
//
// Hero (the one --gradient-prism card): safe to spend until payday. The star
// is the balance forecast — the last 30 days solid, the next 60 dashed, with
// an 80% band that widens as the future gets less certain, and a dot on every
// payday and bill. Most budgeting apps only look backwards; this looks ahead.

import type { Metadata } from "next";
import { CalendarClock, CalendarRange, CreditCard, Repeat, Telescope } from "lucide-react";
import { AddToCalendar } from "@/components/add-to-calendar";
import { CanIAfford } from "@/components/afford";
import { UpcomingList } from "@/components/blocks";
import { ChartCard } from "@/components/chart-card";
import { Legend } from "@/components/charts/core";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { CategoryIcon } from "@/components/category-icon";
import { Card, CardHeader, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { affordBase } from "@/lib/finance/afford";
import { dueReminders, remindable } from "@/lib/finance/calendar";
import { paymentsDue, rateText } from "@/lib/finance/debts";
import { addDays, daysBetween } from "@/lib/finance/dates";
import { capitalized, dayDate, money, money0, shortDate } from "@/lib/finance/format";
import { scheduleText } from "@/lib/finance/income";
import { analyze, FORECAST_DAYS } from "@/lib/finance/model";
import { monthlyCost, setAside } from "@/lib/finance/recurring";
import type { ISODate } from "@/lib/finance/types";
import { dailyBalances } from "@/lib/finance/view";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/t";
import { accountFeedToken } from "@/lib/server/account-store";
import { getFinance } from "@/lib/server/finance";
import { vaultKey, type VaultKey } from "@/lib/server/vault";
import { currentAccount } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Future") };
}

const PAST_DAYS = 30;

export default async function FuturePage() {
  const [data, t] = await Promise.all([getFinance(), getT()]);
  const { locale } = t;
  const a = analyze(data, t);
  const { forecast, safe, checking } = a;

  if (!forecast || !safe || !checking) {
    return (
      <div>
        <PageHeader title={t("Future")} subtitle={t("Where your balance is heading, and what's safe to spend.")} />
        <Card>
          <EmptyState icon={Telescope} title={t("Link a checking account to see ahead")} body={t("We find your paydays and bills, then chart your balance for the next 60 days.")} />
        </Card>
      </div>
    );
  }

  const past = dailyBalances(data.transactions, checking.id, checking.balance, addDays(a.today, -PAST_DAYS), a.today);
  const points = [...past.slice(0, -1).map((p) => ({ date: p.date, value: p.balance })), ...forecast.points.map((p) => ({ date: p.date, value: p.expected }))];
  const n = points.length;
  const todayIndex = PAST_DAYS;
  const labels = points.map((p) => capitalized(dayDate(p.date, locale)));
  const actual = points.map((p, i) => (i <= todayIndex ? p.value : null));
  const projected = points.map((p, i) => (i >= todayIndex ? p.value : null));
  const low = points.map((p, i) => (i < todayIndex ? p.value : forecast.points[i - todayIndex]!.low));
  const high = points.map((p, i) => (i < todayIndex ? p.value : forecast.points[i - todayIndex]!.high));
  const indexOf = new Map(points.map((p, i) => [p.date, i]));
  const markers = forecast.events
    .filter((e) => Math.abs(e.amount) >= 5_000)
    .map((e) => ({ index: indexOf.get(e.date) ?? -1, label: e.merchant, value: money0(e.amount), direction: e.amount > 0 ? ("in" as const) : ("out" as const) }))
    .filter((m) => m.index >= 0);

  const next30 = forecast.events.filter((e) => e.date <= addDays(a.today, 30));
  const inflow = next30.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
  const outflow = next30.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0);
  const subs = a.streams.filter((s) => s.kind === "subscription" && s.amount < 0).sort((x, y) => monthlyCost(y) - monthlyCost(x));
  const subsMonthly = subs.reduce((s, x) => s + monthlyCost(x), 0);
  // Bills that come every three, six or twelve months, and what they cost spread over the year.
  const lessOften = setAside(a.streams);
  const soon = lessOften.bills.filter((s) => s.accountId === checking.id && s.nextDate <= forecast.points.at(-1)!.date);
  // Cards and loans whose lender sends their terms (Plaid Liabilities, when switched on).
  const withTerms = data.accounts.filter((acc) => acc.liability);
  const due = paymentsDue(data.accounts, a.today);
  const reminders = remindable(a.streams, data.accounts, true).length + dueReminders(data.accounts, a.today).length;
  const personal = data.account ? { path: await ownFeedPath() } : undefined;
  const lowest = forecast.lowest;
  const end = forecast.points.at(-1)!;
  const afford = affordBase(a);
  const deposits = next30.filter((e) => e.amount > 0).length;
  const outgoing = next30.filter((e) => e.amount < 0).length;
  const bills = { bills: money0(safe.committed), cushion: money0(safe.cushion) };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("Future")}
        subtitle={t("{account} over the next {n} days — every payday and bill we can see, plus your usual day-to-day.", { account: checking.name, n: FORECAST_DAYS })}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card hero className="p-5 sm:p-6 lg:col-span-5">
          <div className="text-sm font-semibold text-[var(--on-hero-soft)]">{t("Safe to spend today")}</div>
          <div className="mt-1 text-[56px] font-extrabold leading-none tracking-tight">{money0(safe.amount)}</div>
          <p className="mt-3 text-sm text-[var(--on-hero-soft)]">
            {safe.until
              ? t("Until your paycheck on {date} — after {bills} of bills and a {cushion} cushion.", { ...bills, date: dayDate(safe.until, locale) })
              : t("Over the next two weeks — after {bills} of bills and a {cushion} cushion.", bills)}
          </p>
        </Card>
        <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:col-span-7">
          <Figure
            label={t("Lowest point ahead")}
            value={money0(lowest.balance)}
            note={lowest.date === a.today ? t("Today") : t("Around {date}", { date: shortDate(lowest.date, locale) })}
            status={lowest.balance < safe.cushion ? "warn" : "good"}
          />
          <Figure label={t("Balance in {n} days", { n: FORECAST_DAYS })} value={money0(end.expected)} note={t("Likely {low} – {high}", { low: money0(end.low), high: money0(end.high) })} />
          <Figure label={t("Coming in, next 30 days")} value={money0(inflow)} note={deposits === 1 ? t("1 deposit") : t("{n} deposits", { n: deposits })} />
          <Figure
            label={t("Going out, next 30 days")}
            value={money0(outflow)}
            note={outgoing === 1 ? t("1 bill or transfer") : t("{n} bills and transfers", { n: outgoing })}
          />
        </div>
      </div>

      <ChartCard
        title={t("Where your balance is heading")}
        subtitle={t("Solid is what happened; dashed is the forecast. The shaded band is where it lands 8 times in 10.")}
        legend={
          <Legend
            items={[
              { label: t("Balance"), color: "var(--accent)", kind: "line" },
              { label: t("Forecast"), color: "var(--accent)", kind: "dash" },
              { label: t("Likely range"), color: "var(--accent)", kind: "rect" },
              { label: t("Paycheck"), color: "var(--flow-in)", kind: "dot" },
              { label: t("Bill"), color: "var(--flow-out)", kind: "dot" },
            ]}
          />
        }
        table={{
          caption: t("Daily checking balance: actual, then forecast with likely range"),
          columns: [t("Day"), t("Balance"), t("Likely low"), t("Likely high")],
          rows: points.map((p, i) => [
            i > todayIndex ? t("{date} (forecast)", { date: p.date }) : p.date,
            money0(p.value),
            i > todayIndex ? money0(low[i]!) : "—",
            i > todayIndex ? money0(high[i]!) : "—",
          ]),
        }}
      >
        <TimeSeriesChart
          labels={labels}
          axisLabels={points.map((p) => shortDate(p.date, locale))}
          series={[
            { id: "actual", label: t("Balance"), color: "var(--accent)", values: actual, area: true },
            { id: "projected", label: t("Forecast"), color: "var(--accent)", values: projected, dashFrom: 0 },
          ]}
          band={{ low, high, label: t("Likely range"), color: "var(--accent)" }}
          markers={markers.map((m) => ({ ...m }))}
          todayIndex={todayIndex}
          curve="step"
          include={0}
          height={320}
          maxAxisLabels={7}
          ariaLabel={t("Checking balance forecast: {today} today, lowest {lowest} around {date}, about {end} in {n} days.", {
            today: money0(checking.balance),
            lowest: money0(lowest.balance),
            date: shortDate(lowest.date, locale),
            end: money0(end.expected),
            n: FORECAST_DAYS,
          })}
        />
        <p className="sr-only">{t("{n} days shown.", { n })}</p>
      </ChartCard>

      {afford ? (
        <Card className="p-5 sm:p-6">
          <CardHeader title={t("Can I afford it?")} subtitle={t("Try a purchase, a new monthly bill or a raise against everything above. Nothing you try is saved.")} />
          <div className="mt-4">
            <CanIAfford base={afford} />
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <Card className="p-5 sm:p-6 lg:col-span-7">
          <CardHeader
            title={t("The next 30 days")}
            subtitle={t("Paydays, bills and transfers we found repeating")}
            action={
              reminders > 0 ? (
                <AddToCalendar demo={data.source === "demo"} count={reminders} personal={personal} signIn={data.accountsEnabled && !data.account} />
              ) : undefined
            }
          />
          <div className="mt-2">
            {next30.length ? (
              <UpcomingList events={next30} limit={14} t={t} />
            ) : (
              <EmptyState icon={CalendarClock} title={t("Nothing scheduled")} body={t("Bills and paychecks that repeat show up here once we've seen them twice.")} />
            )}
          </div>
        </Card>

        <div className="space-y-5 lg:col-span-5">
        {withTerms.length ? (
          <Card className="p-5 sm:p-6">
            <CardHeader title={t("Card and loan payments")} subtitle={t("Due dates and minimums from your lenders")} />
            {due.length ? (
              <ul className="mt-3 divide-y divide-[var(--line)]">
                {due.map(({ account, liability }) => (
                  <li key={account.id} className="flex items-center gap-3 py-2.5">
                    <div className="grid size-8 shrink-0 place-items-center rounded-ctl bg-surface-2 text-ink-2">
                      <CreditCard aria-hidden className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 text-sm font-semibold text-ink-1">
                        <span className="truncate">{account.name}</span>
                        {account.mask ? <span className="shrink-0 font-normal text-ink-3">&nbsp;·· {account.mask}</span> : null}
                      </div>
                      <div className="text-xs text-ink-3">
                        {dueText(liability.dueDate, a.today, t)}
                        {liability.apr !== null ? ` · ${rateText(liability.apr, account.kind, t)}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="num text-sm font-bold text-ink-1">{liability.minimumPayment !== null ? t("{amount} min", { amount: money(liability.minimumPayment) }) : "—"}</div>
                      {liability.overdue ? (
                        <StatusPill status="warn" className="mt-1">
                          {t("Overdue")}
                        </StatusPill>
                      ) : liability.statementBalance !== null ? (
                        <div className="num text-xs text-ink-3">{t("Statement {amount}", { amount: money0(liability.statementBalance) })}</div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={CreditCard}
                title={t("Nothing due in the next few weeks")}
                body={t("When a card or loan issues its next statement, its due date and minimum payment show up here.")}
              />
            )}
          </Card>
        ) : null}
        <Card className="p-5 sm:p-6">
          <CardHeader
            title={t("Bills that don't come every month")}
            subtitle={lessOften.bills.length ? t("Put aside {amount} a month and they're paid for when they land", { amount: money0(lessOften.monthly) }) : undefined}
          />
          {lessOften.bills.length ? (
            <>
              <ul className="mt-3 divide-y divide-[var(--line)]">
                {lessOften.bills.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-2.5">
                    <CategoryIcon category={s.category} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-ink-1 [overflow-wrap:anywhere] sm:truncate">{s.merchant}</div>
                      <div className="text-xs text-ink-3">
                        {t("{when} · next {date}", {
                          when: scheduleText(s.cadence, undefined, t),
                          date:
                            s.nextDate.slice(0, 4) === a.today.slice(0, 4)
                              ? shortDate(s.nextDate, locale)
                              : t("{date}, {year}", { date: shortDate(s.nextDate, locale), year: s.nextDate.slice(0, 4) }),
                        })}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="num text-sm font-bold text-ink-1">{s.variable ? t("about {amount}", { amount: money0(Math.abs(s.amount)) }) : money(Math.abs(s.amount))}</div>
                      <div className="num text-xs text-ink-3">{t("{amount} a month", { amount: money0(monthlyCost(s)) })}</div>
                    </div>
                  </li>
                ))}
              </ul>
              {soon.length ? (
                <p className="mt-3 text-xs text-ink-3">
                  {soon.length === 1
                    ? t("{merchant} comes out of {account} in the next {n} days, so it's already in the forecast above.", {
                        merchant: soon[0]!.merchant,
                        account: checking.name,
                        n: FORECAST_DAYS,
                      })
                    : t("{count} of these come out of {account} in the next {n} days, so they're already in the forecast above.", {
                        count: soon.length,
                        account: checking.name,
                        n: FORECAST_DAYS,
                      })}
                </p>
              ) : null}
            </>
          ) : (
            <EmptyState
              icon={CalendarRange}
              title={t("None spotted yet")}
              body={t("Car insurance, a yearly membership, the water bill every three months: once we've seen one come round, it shows here with what to put aside each month.")}
            />
          )}
        </Card>
        <Card className="p-5 sm:p-6">
          <CardHeader
            title={t("Subscriptions")}
            subtitle={subs.length ? t("{monthly} a month · {yearly} a year", { monthly: money0(subsMonthly), yearly: money0(subsMonthly * 12) }) : undefined}
          />
          {subs.length ? (
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {subs.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2.5">
                  <CategoryIcon category={s.category} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-ink-1 [overflow-wrap:anywhere] sm:truncate">{s.merchant}</div>
                    <div className="text-xs text-ink-3">{t("Next {date}", { date: shortDate(s.nextDate, locale) })}</div>
                  </div>
                  <div className="text-right">
                    <div className="num text-sm font-bold text-ink-1">{money(Math.abs(s.amount))}</div>
                    {s.priceChange ? (
                      <StatusPill status="warn" className="mt-1">
                        {t("Up from {amount}", { amount: money(Math.abs(s.priceChange.from)) })}
                      </StatusPill>
                    ) : (
                      <div className="text-xs text-ink-3">{t("monthly")}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Repeat} title={t("No subscriptions spotted")} body={t("Anything that charges you the same amount every month shows up here, with price rises flagged.")} />
          )}
        </Card>
        </div>
      </div>
    </div>
  );
}

/** "Due Oct 14, in 5 days": one sentence for each, so a language can say the day its own way. */
function dueText(due: ISODate, today: ISODate, t: T): string {
  const n = daysBetween(today, due);
  const date = shortDate(due, t.locale);
  return n <= 0 ? t("Due {date}, today", { date }) : n === 1 ? t("Due {date}, tomorrow", { date }) : t("Due {date}, in {n} days", { date, n });
}

function Figure({ label, value, note, status }: { label: string; value: string; note: string; status?: "good" | "warn" }) {
  return (
    <Card className="p-4">
      <div className="text-[13px] font-semibold text-ink-2">{label}</div>
      <div className="mt-2 text-[26px] font-extrabold leading-none tracking-tight text-ink-1">{value}</div>
      <div className="mt-2 text-xs text-ink-3">
        {status ? <StatusPill status={status}>{note}</StatusPill> : note}
      </div>
    </Card>
  );
}

/** The signed-in person's calendar feed path, if they've made one. */
async function ownFeedPath(): Promise<string | null> {
  const account = await currentAccount();
  let key: VaultKey | null = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  if (!account || !key) return null;
  const token = await accountFeedToken(account, key, { create: false }).catch(() => null);
  return token ? `/calendar/feed/${token}.ics` : null;
}
