// src/app/check-in/page.tsx — the money check-in (finance/check-in.ts): one
// page for once a month. Last month in numbers, what's worth a look now
// (each with the page that settles it), what changed, and the month ahead.
//
// Hero (the one --gradient-prism card): what was kept last month, the
// number the rest of the page explains. Nothing here is stored: an item
// leaves when what it's about is settled.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ClipboardCheck } from "lucide-react";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { checkIn, type CheckItem } from "@/lib/finance/check-in";
import { dayDate, money, money0, monthLong, percent } from "@/lib/finance/format";
import { analyze } from "@/lib/finance/model";
import { getT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/t";
import { getFinance } from "@/lib/server/finance";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Check-in") };
}

/** Each item's tone, as a dot and a word (never colour alone). */
const TONES: Record<CheckItem["tone"], { word: string; dot: string }> = {
  now: { word: msg("Now"), dot: "bg-crit" },
  soon: { word: msg("This month"), dot: "bg-warn" },
  idea: { word: msg("Good to know"), dot: "bg-accent" },
};

export default async function CheckInPage() {
  const [data, t] = await Promise.all([getFinance(), getT()]);
  const { locale } = t;
  const c = checkIn(analyze(data, t), t);
  const m = c.month;
  // Spanish keeps a month lower case inside a sentence, as format.ts writes it.
  const monthName = m ? monthLong(`${m.month}-01`, locale) : null;
  const kept = m ? m.income - m.spent : 0;
  const keptBefore = m?.before ? m.before.income - m.before.spent : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={monthName ? t("Your {month} check-in", { month: monthName }) : t("Check-in")}
        subtitle={t("Once a month: how last month went, what's worth a look now, and what's coming.")}
      />

      {data.source === "demo" ? (
        <Card className="p-4 text-sm text-ink-2">
          {data.account ? t("This is the example household. Link a bank and your own check-in shows here.") : t("This is the example household. Sign in and link a bank to see your own check-in.")}
        </Card>
      ) : null}

      {m ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <Card hero className="p-5 sm:p-6 lg:col-span-5">
            <div className="text-sm font-semibold text-[var(--on-hero-soft)]">{kept >= 0 ? t("You kept, in {month}", { month: monthName! }) : t("You spent more than came in, in {month}", { month: monthName! })}</div>
            <div className="mt-1 text-[56px] font-extrabold leading-none tracking-tight">{money0(Math.abs(kept))}</div>
            <p className="mt-3 text-sm text-[var(--on-hero-soft)]">
              {keptBefore === null
                ? t("{income} came in and {spent} went out.", { income: money0(m.income), spent: money0(m.spent) })
                : keptBefore >= 0
                  ? t("{income} came in and {spent} went out. The month before, you kept {before}.", { income: money0(m.income), spent: money0(m.spent), before: money0(keptBefore) })
                  : t("{income} came in and {spent} went out. The month before, you spent {before} more than came in.", { income: money0(m.income), spent: money0(m.spent), before: money0(-keptBefore) })}
            </p>
          </Card>
          <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:col-span-7 lg:grid-cols-3">
            <Figure
              label={t("Spent")}
              value={money0(m.spent)}
              note={m.before ? (m.spent <= m.before.spent ? t("{amount} less than the month before", { amount: money0(m.before.spent - m.spent) }) : t("{amount} more than the month before", { amount: money0(m.spent - m.before.spent) })) : t("In {month}", { month: monthName! })}
            />
            <Figure
              label={t("Net worth")}
              value={m.netWorth ? money0(m.netWorth.end) : "—"}
              note={m.netWorth ? (m.netWorth.change >= 0 ? t("Up {amount} over the month", { amount: money0(m.netWorth.change) }) : t("Down {amount} over the month", { amount: money0(-m.netWorth.change) })) : t("Not enough history yet")}
            />
            <Figure
              label={t("Saved")}
              value={m.income > 0 ? percent(Math.max(0, kept) / m.income) : "—"}
              note={t("Of what came in")}
              className="col-span-2 lg:col-span-1"
            />
          </div>
        </div>
      ) : null}

      <Card className="p-5 sm:p-6">
        <CardHeader title={t("Worth a look")} subtitle={t("The most pressing first. Each one leaves this list once it's settled.")} />
        {c.items.length ? (
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {c.items.map((i) => (
              <li key={i.id}>
                {/* On a phone the urgency sits above the title, so the title keeps the width. */}
                <Link href={i.href} className="group flex flex-col gap-1 rounded-ctl py-3 hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-[var(--focus)] sm:flex-row sm:items-start sm:gap-3">
                  <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-ink-3 sm:mt-1.5">
                    <span aria-hidden className={`size-2 rounded-pill ${TONES[i.tone].dot}`} />
                    <span className="sm:w-20">{t(TONES[i.tone].word)}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink-1 [overflow-wrap:anywhere]">{i.title}</span>
                    <span className="block text-xs text-ink-3">{i.detail}</span>
                  </span>
                  <ArrowRight aria-hidden className="mt-1 hidden size-4 shrink-0 text-ink-3 group-hover:text-accent sm:block" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={ClipboardCheck} title={t("Nothing needs you right now")} body={t("Bills that may not be covered, late refunds, fees you could ask back, budgets running over and cards coming due show here when there are any.")} />
        )}
      </Card>

      {c.moves.length || c.rises.length ? (
        <Card className="p-5 sm:p-6">
          <CardHeader title={monthName ? t("What changed in {month}", { month: monthName }) : t("What changed")} subtitle={t("Where spending moved most against the month before, and prices that went up in a year.")} />
          <ul className="mt-3 divide-y divide-[var(--line)] text-sm">
            {c.moves.map((mv) => (
              <li key={mv.category} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block font-semibold text-ink-1">{mv.label}</span>
                  <span className="num block text-xs text-ink-3">
                    {money0(mv.before)} → {money0(mv.now)}
                  </span>
                </span>
                <span className="num shrink-0 font-semibold text-ink-1">{mv.change > 0 ? t("{amount} more", { amount: money0(mv.change) }) : t("{amount} less", { amount: money0(-mv.change) })}</span>
              </li>
            ))}
            {c.rises.map((r) => (
              <li key={r.name} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block font-semibold text-ink-1 [overflow-wrap:anywhere]">{r.name}</span>
                  <span className="num block text-xs text-ink-3">{t("{before} a year ago, {after} now", { before: money(r.before), after: money(r.after) })}</span>
                </span>
                <span className="num shrink-0 font-semibold text-ink-1">{t("{pct} more", { pct: percent(r.change, 1) })}</span>
              </li>
            ))}
          </ul>
          <Link href="/spending" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent-ink underline-offset-2 hover:underline">
            {t("See it all on Spending")}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Card>
      ) : null}

      <Card className="p-5 sm:p-6">
        <CardHeader title={t("The month ahead")} subtitle={t("From the bills and paydays Prism found repeating.")} />
        <dl className="mt-3 divide-y divide-[var(--line)] text-sm">
          <Row
            label={t("Bills in the next 30 days")}
            value={c.ahead ? (c.ahead.count === 1 ? t("1 bill, {amount}", { amount: money0(c.ahead.total) }) : t("{n} bills, {amount}", { n: c.ahead.count, amount: money0(c.ahead.total) })) : "—"}
          />
          <Row label={t("Next payday")} value={c.nextPayday ? dayDate(c.nextPayday, locale) : "—"} />
        </dl>
        <Link href="/future" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent-ink underline-offset-2 hover:underline">
          {t("See the plan on Future")}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-ink-2">{label}</dt>
      <dd className="num font-semibold text-ink-1">{value}</dd>
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

