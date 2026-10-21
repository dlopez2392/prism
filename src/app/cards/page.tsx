// src/app/cards/page.tsx — the person's credit cards (finance/cards.ts): how
// much of each limit is used, when its statement closes, what's due, and what
// it has cost in interest and fees.
//
// Hero (the one --gradient-prism card): how much of the limits is in use,
// across every card whose bank reports a limit. That's the number the credit
// bureaus look at; everything else on the page is what moves it, or what the
// cards cost.

import type { Metadata } from "next";
import { CreditCard, Info } from "lucide-react";
import { ButtonLink, Card, CardHeader, EmptyState, Meter, PageHeader, StatusPill } from "@/components/ui";
import { cardsFor, type CardRow } from "@/lib/finance/cards";
import { payLaterFor, PROVIDER_NAMES, type PayLater } from "@/lib/finance/paylater";
import { rateText } from "@/lib/finance/debts";
import { money, money0, percent, shortDate } from "@/lib/finance/format";
import type { Account } from "@/lib/finance/types";
import type { T } from "@/lib/i18n/t";
import { getT } from "@/lib/i18n/server";
import { getFinance } from "@/lib/server/finance";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Cards") };
}

/** The 30% line on every meter: the level people usually aim to stay under. */
const LINE = 0.3;

export default async function CardsPage() {
  const [data, t] = await Promise.all([getFinance(), getT()]);
  const c = cardsFor(data.accounts, data.transactions, data.today);
  const later = payLaterFor(data.transactions, data.today);
  const header = <PageHeader title={t("Cards")} subtitle={t("How much of each card's limit you're using, when its statement closes, and what it has cost you.")} />;

  if (!c.cards.length) {
    return (
      <div className="space-y-5">
        {header}
        <Card>
          <EmptyState
            icon={CreditCard}
            title={t("No credit cards yet")}
            body={t("Connect a credit card and its balance, limit, statement date and what's due show here.")}
            action={<ButtonLink href="/connections">{t("Go to Connections")}</ButtonLink>}
          />
        </Card>
        {later.active.length || later.finished.length ? <PayLaterCard later={later} accounts={data.accounts} t={t} /> : null}
      </div>
    );
  }

  const n = c.cards.length;
  const nextDue = c.cards
    .filter((x) => x.dueDate)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))[0];
  const withLimits = c.cards.filter((x) => x.limit !== null).length;

  return (
    <div className="space-y-5">
      {header}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card hero className="p-5 sm:p-6 lg:col-span-5">
          {c.usage !== null ? (
            <>
              <div className="text-sm font-semibold text-[var(--on-hero-soft)]">{t("Of your credit limits, in use")}</div>
              <div className="mt-1 text-[56px] font-extrabold leading-none tracking-tight">{percent(c.usage)}</div>
              <p className="mt-3 text-sm text-[var(--on-hero-soft)]">
                {withLimits === 1
                  ? t("{owed} owed against a {limits} limit, on 1 card.", { owed: money0(c.owed), limits: money0(c.limits) })
                  : t("{owed} owed against {limits} of limits, on {n} cards.", { owed: money0(c.owed), limits: money0(c.limits), n: withLimits })}
              </p>
            </>
          ) : (
            <>
              <div className="text-sm font-semibold text-[var(--on-hero-soft)]">{t("Owed on your cards")}</div>
              <div className="mt-1 text-[56px] font-extrabold leading-none tracking-tight">{money0(c.owed)}</div>
              <p className="mt-3 text-sm text-[var(--on-hero-soft)]">{n === 1 ? t("On 1 card. Its bank doesn't report a limit.") : t("On {n} cards. Their banks don't report limits.", { n })}</p>
            </>
          )}
        </Card>
        <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:col-span-7 lg:grid-cols-3">
          <Figure label={t("Interest, last 12 months")} value={money0(c.interest12)} note={t("Charged on your cards")} />
          <Figure label={t("Annual fees")} value={money0(c.fees12)} note={t("Over the last 12 months")} />
          <Figure
            label={t("Next payment due")}
            value={nextDue ? shortDate(nextDue.dueDate!, t.locale) : "—"}
            note={nextDue ? (nextDue.minimumPayment !== null ? t("{card}: {minimum} minimum", { card: nextDue.name, minimum: money(nextDue.minimumPayment) }) : nextDue.name) : t("Not reported by your card's bank")}
            className="col-span-2 lg:col-span-1"
          />
        </div>
      </div>

      <div className={n > 1 ? "grid grid-cols-1 gap-5 lg:grid-cols-2" : "grid grid-cols-1 gap-5"}>
        {c.cards.map((card) => (
          <CardPanel key={card.id} card={card} t={t} />
        ))}
      </div>

      <PayLaterCard later={later} accounts={data.accounts} t={t} />

      <Card className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-ctl bg-accent-soft text-accent">
            <Info aria-hidden className="size-[18px]" />
          </span>
          <div className="min-w-0 text-sm">
            <h2 className="text-[15px] font-bold tracking-tight text-ink-1">{t("Why the statement date matters")}</h2>
            <p className="mt-1 text-ink-2">
              {t("A card tells the credit bureaus the balance on your statement, even when you pay it in full every month. Paying some of it before the statement closes lowers that balance; under 30% of the limit is the level people usually go by, and under 10% is better still.")}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function CardPanel({ card, t }: { card: CardRow; t: T }) {
  const { locale } = t;
  const level = card.usage === null ? null : card.usage <= 0.1 ? "good" : card.usage <= LINE ? "neutral" : "warn";
  return (
    <Card as="article" className="p-5 sm:p-6">
      <CardHeader title={card.mask ? `${card.name} ••${card.mask}` : card.name} subtitle={card.limit !== null ? t("{owed} of a {limit} limit", { owed: money(card.owed), limit: money0(card.limit) }) : t("{owed} owed", { owed: money(card.owed) })} />
      {card.usage !== null ? (
        <div className="mt-4">
          <Meter ratio={card.usage} color="var(--c-1)" marker={LINE} label={t("{card}: share of the limit in use", { card: card.name })} />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <StatusPill status={level === "good" ? "good" : level === "warn" ? "warn" : "neutral"}>
              {level === "good" ? t("{pct} used: under 10%", { pct: percent(card.usage) }) : level === "warn" ? t("{pct} used: over 30%", { pct: percent(card.usage) }) : t("{pct} used: under 30%", { pct: percent(card.usage) })}
            </StatusPill>
            <span className="text-xs text-ink-3">{t("The line marks 30%")}</span>
          </div>
        </div>
      ) : null}

      {card.payToReach ? (
        <p className="mt-4 rounded-ctl bg-surface-2 p-3 text-sm text-ink-1">
          {card.payToReach.by
            ? t("Paying {amount} before {date}, when its statement closes, would bring the balance it reports to {level} of its limit.", {
                amount: money(card.payToReach.amount),
                date: shortDate(card.payToReach.by, locale),
                level: percent(card.payToReach.level),
              })
            : t("Paying {amount} before its statement closes would bring the balance it reports to {level} of its limit.", {
                amount: money(card.payToReach.amount),
                level: percent(card.payToReach.level),
              })}
        </p>
      ) : null}

      <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <Fact
          label={t("Statement")}
          value={
            card.statementDate
              ? t("Closed {date} · next {next}", { date: shortDate(card.statementDate, locale), next: shortDate(card.nextClose!, locale) })
              : t("Not reported by its bank")
          }
        />
        <Fact
          label={t("Next payment")}
          value={
            card.dueDate
              ? card.minimumPayment !== null
                ? t("Due {date} · {minimum} minimum", { date: shortDate(card.dueDate, locale), minimum: money(card.minimumPayment) })
                : t("Due {date}", { date: shortDate(card.dueDate, locale) })
              : t("Not reported by its bank")
          }
        />
        {card.statementBalance !== null ? <Fact label={t("Statement balance")} value={money(card.statementBalance)} /> : null}
        {card.apr !== null ? <Fact label={t("Interest rate")} value={rateText(card.apr, "credit", t)} /> : null}
        <Fact
          label={t("Interest, last 12 months")}
          value={card.interest.last12 > 0 ? t("{amount} ({thisYear} this year)", { amount: money(card.interest.last12), thisYear: money(card.interest.thisYear) }) : t("None")}
        />
        <Fact label={t("Annual fee")} value={card.annualFee ? t("{amount} on {date}", { amount: money(card.annualFee.amount), date: shortDate(card.annualFee.date, locale) }) : t("None charged lately")} />
      </dl>
      {card.overdue ? (
        <div className="mt-3">
          <StatusPill status="crit">{t("Its bank says a payment is overdue")}</StatusPill>
        </div>
      ) : null}
    </Card>
  );
}

/** Buy now, pay later: each plan still running, what it takes next, and what's still to pay as far as its payments show. */
function PayLaterCard({ later, accounts, t }: { later: PayLater; accounts: Account[]; t: T }) {
  const { locale } = t;
  const name = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? (a.mask ? `${a.name} ••${a.mask}` : a.name) : "";
  };
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader
        title={t("Buy now, pay later")}
        subtitle={
          later.active.length
            ? t("At least {owed} still to pay, {next30} of it in the next 30 days. Found from your payments to Affirm, Klarna, Afterpay, Sezzle and Zip.", {
                owed: money(later.owed),
                next30: money(later.next30),
              })
            : t("Plans with Affirm, Klarna, Afterpay, Sezzle and Zip show here, found from your payments to them.")
        }
      />
      {later.active.length ? (
        <ul className="mt-3 divide-y divide-[var(--line)]">
          {later.active.map((p) => (
            <li key={`${p.provider}:${p.accountId}:${p.paid[0]!.id}`} className="py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink-1">{PROVIDER_NAMES[p.provider]}</div>
                  <div className="text-xs text-ink-3">
                    {p.cadence === "biweekly"
                      ? t("Every two weeks · {paid} of 4 paid · next {date}", { paid: p.paid.length, date: shortDate(p.next!, locale) })
                      : t("Every month · next {date}", { date: shortDate(p.next!, locale) })}
                    {name(p.accountId) ? ` · ${name(p.accountId)}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-sm font-bold text-ink-1">{money(p.installment)}</div>
                  <div className="text-xs text-ink-3">{p.owed !== null ? t("{owed} left", { owed: money(p.owed) }) : t("a month")}</div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-ink-2">{t("No plans running right now.")}</p>
      )}
      {later.finished.length ? (
        <p className="mt-3 text-xs text-ink-3">
          {later.finished.length === 1 ? t("1 plan paid off in the last 90 days.") : t("{n} plans paid off in the last 90 days.", { n: later.finished.length })}
        </p>
      ) : null}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-ink-3">{label}</dt>
      <dd className="text-ink-1 [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function Figure({ label, value, note, className }: { label: string; value: string; note: string; className?: string }) {
  return (
    <Card className={`p-4 ${className ?? ""}`}>
      <div className="text-[13px] font-semibold text-ink-2">{label}</div>
      <div className="mt-2 text-[26px] font-extrabold leading-none tracking-tight text-ink-1">{value}</div>
      <div className="mt-2 text-xs text-ink-3">{note}</div>
    </Card>
  );
}
