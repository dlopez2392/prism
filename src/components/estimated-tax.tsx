// src/components/estimated-tax.tsx
//
// The estimated-tax card on Taxes (finance/estimated-tax.ts): the four due
// dates of the tax year being paid, each with what last year's safe harbor
// asks for by then (when Prism has last year's return), what Prism saw reach
// the IRS by then, and a status that is a word as well as an icon. Said as
// the IRS's rule, never as what to pay; Prism never pays anything.

import Link from "next/link";
import { Card, CardHeader, StatusPill, type Status } from "@/components/ui";
import type { EstimatedQuarter, EstimatedTax } from "@/lib/finance/estimated-tax";
import { money0, shortDate, signedMoney0 } from "@/lib/finance/format";
import type { T } from "@/lib/i18n/t";

function stateOf(q: EstimatedQuarter, t: T): { status: Status; word: string } {
  if (q.state === "paid") return { status: "good", word: q.target === null ? t("Payment seen") : t("On track") };
  if (q.state === "short") return q.target === null ? { status: "neutral", word: t("No payment seen") } : { status: "warn", word: t("{amount} short", { amount: money0(q.target - q.paid) }) };
  if (q.state === "soon") return { status: "serious", word: t("Due soon") };
  return { status: "neutral", word: t("Coming up") };
}

export function EstimatedTaxCard({ e, canAddReturn, t }: { e: EstimatedTax; canAddReturn: boolean; t: T }) {
  const { locale } = t;
  const fullDate = (d: string) => `${shortDate(d, locale)}, ${d.slice(0, 4)}`;
  return (
    <Card as="article" className="p-5 sm:p-6">
      <CardHeader
        title={t("Estimated tax for {year}", { year: e.taxYear })}
        subtitle={
          e.why === "business"
            ? t("Your business made {amount} so far this year, and no paycheck withholds tax on it.", { amount: signedMoney0(e.businessNet ?? 0) })
            : e.why === "estimated"
              ? t("Your {year} return had estimated payments, so the IRS likely expects them again.", { year: e.taxYear - 1 })
              : t("Your {year} return had a balance due of $1,000 or more, the line at which the IRS generally expects estimated payments.", { year: e.taxYear - 1 })
        }
      />
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[22rem] text-sm">
          <caption className="sr-only">{t("Estimated tax due dates for {year}", { year: e.taxYear })}</caption>
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3">
              <th scope="col" className="py-2 font-bold">{t("Due")}</th>
              {e.perQuarter !== null ? <th scope="col" className="py-2 pl-3 text-right font-bold">{t("By then")}</th> : null}
              <th scope="col" className="py-2 pl-3 text-right font-bold">{t("Paid by then")}</th>
              <th scope="col" className="py-2 pl-3 font-bold"><span className="sr-only">{t("Status")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {e.quarters.map((q) => {
              const s = stateOf(q, t);
              return (
                <tr key={q.n}>
                  <th scope="row" className="whitespace-nowrap py-2.5 text-left font-semibold text-ink-1">
                    {fullDate(q.due)}
                  </th>
                  {e.perQuarter !== null ? <td className="num whitespace-nowrap py-2.5 pl-3 text-right text-ink-1">{money0(q.target ?? 0)}</td> : null}
                  <td className="num whitespace-nowrap py-2.5 pl-3 text-right text-ink-1">{money0(q.paid)}</td>
                  <td className="py-2.5 pl-3">
                    <StatusPill status={s.status}>{s.word}</StatusPill>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {e.safeHarbor && e.perQuarter !== null ? (
        <p className="mt-3 text-sm text-ink-2">
          {e.perQuarter === 0
            ? t("Last year's withholding ({withheld}) already covered the safe-harbor amount ({amount}). If this year's is about the same, there may be nothing to pay.", {
                withheld: money0(e.withheldLastYear ?? 0),
                amount: money0(e.safeHarbor.amount),
              })
            : t("Paying {amount} in all for {year}, {share} of your {last} total tax, generally avoids an underpayment penalty. With withholding like last year's ({withheld}), that leaves about {quarter} a quarter.", {
                amount: money0(e.safeHarbor.amount),
                year: e.taxYear,
                share: e.safeHarbor.share === 1 ? "100%" : "110%",
                last: e.safeHarbor.lastYear,
                withheld: money0(e.withheldLastYear ?? 0),
                quarter: money0(e.perQuarter),
              })}
        </p>
      ) : (
        <p className="mt-3 text-sm text-ink-2">
          {t("Add last year's return and Prism shows what each date asks for under the safe-harbor rule.")}{" "}
          {canAddReturn ? (
            <Link href="/taxes/return" className="font-semibold text-accent-ink underline-offset-2 hover:underline">
              {t("Add your return")}
            </Link>
          ) : null}
        </p>
      )}
      <p className="mt-2 text-xs text-ink-3">
        {e.lastYearsBill
          ? t("Not counted: {amount} paid on {date}, last year's balance due. ", { amount: money0(-e.lastYearsBill.amount), date: shortDate(e.lastYearsBill.date, locale) })
          : ""}
        {t("Prism counts payments to the IRS from your linked accounts. One made by check, or from an account that isn't linked, isn't here. Pay at irs.gov/payments; Prism never pays anything.")}
      </p>
    </Card>
  );
}
