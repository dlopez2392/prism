// src/components/income.tsx — who pays you, how often and what lands (Cash
// flow), from finance/income.ts. Not scoped by the page's range: a paycheck
// is about now, and the income mix is the last three full months, labelled.

import { Banknote, Coins } from "lucide-react";
import { ButtonLink, Card, CardHeader, EmptyState } from "@/components/ui";
import { dayDate, money, money0, monthYear, shortDate } from "@/lib/finance/format";
import type { IncomeSummary } from "@/lib/finance/income";
import type { Account } from "@/lib/finance/types";

export function IncomeCards({ income, accounts, demo, household = false }: { income: IncomeSummary; accounts: Account[]; demo: boolean; household?: boolean }) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const months = income.months;
  const span = months.length ? (months.length === 1 ? monthYear(`${months[0]}-01`) : `${monthYear(`${months[0]}-01`)} – ${monthYear(`${months.at(-1)}-01`)}`) : null;

  return (
    <section id="income" className="grid scroll-mt-6 grid-cols-1 gap-5 lg:grid-cols-12">
      <Card className="p-5 sm:p-6 lg:col-span-7">
        <CardHeader
          title={household ? "Paychecks into shared accounts" : "Your paychecks"}
          subtitle={
            income.paychecks.length > 1
              ? `Together about ${money0(income.paychecks.reduce((s, p) => s + p.yearly, 0))} a year, from your deposits. A payday on a weekend or bank holiday lands the business day before.`
              : income.paychecks.length
                ? "Found from your deposits. A payday on a weekend or bank holiday lands the business day before."
                : "Found from your deposits, with no payroll login."
          }
        />
        {income.paychecks.length ? (
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {income.paychecks.map((p) => {
              const into = byId.get(p.accountId);
              const up = p.change ? p.change.to > p.change.from : false;
              return (
                <li key={p.id} className="flex items-center gap-3 py-3">
                  <div className="grid size-8 shrink-0 place-items-center rounded-ctl bg-surface-2 text-ink-2">
                    <Banknote aria-hidden className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink-1">{p.payer}</div>
                    <div className="text-xs text-ink-2">
                      {p.when} · next {dayDate(p.next)}
                    </div>
                    {into ? (
                      <div className="truncate text-xs text-ink-3">
                        Into {into.name}
                        {into.mask ? ` ·· ${into.mask}` : ""}
                      </div>
                    ) : null}
                    {p.change ? (
                      <div className="text-xs text-ink-2">
                        {up ? "Up" : "Down"} {money(Math.abs(p.change.to - p.change.from))} a payday since {shortDate(p.change.date)}
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="num text-sm font-bold text-ink-1">
                      {p.variable ? "about " : ""}
                      {money(p.takeHome)}
                    </div>
                    <div className="num text-xs text-ink-3">about {money0(p.yearly)} a year</div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={Banknote}
            title="No paycheck found yet"
            body="When the same employer pays into a linked account three times, Prism learns your payday and take-home pay, and your forecast counts on them."
            action={demo ? <ButtonLink href="/connections">Connect a bank</ButtonLink> : undefined}
          />
        )}
      </Card>

      <Card className="p-5 sm:p-6 lg:col-span-5">
        <CardHeader title={household ? "Where the household's income comes from" : "Where your income comes from"} subtitle={span ? `A month on average, ${span}` : undefined} />
        {income.byKind.length ? (
          <>
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {income.byKind.map((k) => (
                <li key={k.kind} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-sm text-ink-1">{k.label}</span>
                  <span className="num text-sm font-semibold text-ink-1">{money0(k.monthly)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-1 flex items-center justify-between gap-3 border-t border-line-strong pt-2.5">
              <span className="text-sm font-semibold text-ink-1">In all</span>
              <span className="num text-sm font-bold text-ink-1">{money0(income.monthly)} a month</span>
            </div>
          </>
        ) : (
          <EmptyState
            icon={Coins}
            title="No income counted yet"
            body="After a full month of history, this shows what kind of money comes in: pay, interest, dividends, benefits and the rest."
          />
        )}
      </Card>
    </section>
  );
}
