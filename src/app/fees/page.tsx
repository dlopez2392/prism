// src/app/fees/page.tsx — money lost without noticing (finance/fees.ts):
// every fee the person's banks and cards charged over the last year, what
// came back, a request to ask for each of the rest back, and charges that may
// have gone through twice.
//
// Hero (the one --gradient-prism card): what fees cost over the last 12
// months, after what was given back. That's the number worth acting on.

import type { Metadata } from "next";
import { BadgeDollarSign, Copy } from "lucide-react";
import { FeeRequest } from "@/components/fee-request";
import { Card, CardHeader, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { FEE_LABELS, feesFor, refundRequest } from "@/lib/finance/fees";
import { money, money0, shortDate } from "@/lib/finance/format";
import type { Account } from "@/lib/finance/types";
import { getT } from "@/lib/i18n/server";
import { getFinance } from "@/lib/server/finance";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Fees") };
}

function accountLabel(a: Account | undefined): string {
  if (!a) return "";
  return a.mask ? `${a.name} ••${a.mask}` : a.name;
}

export default async function FeesPage() {
  const [data, t] = await Promise.all([getFinance(), getT()]);
  const { locale } = t;
  const f = feesFor(data.transactions, data.today);
  const accounts = new Map([...data.accounts, ...(data.hiddenAccounts ?? [])].map((a) => [a.id, a]));
  const lost = f.paid12 - f.refunded12;
  const refundedCount = f.fees.filter((x) => x.refund).length;
  const header = <PageHeader title={t("Fees")} subtitle={t("Every fee your banks and cards charged this past year, what came back, and how to ask for the rest.")} />;

  if (!f.fees.length && !f.doubles.length) {
    return (
      <div>
        {header}
        <Card>
          <EmptyState
            icon={BadgeDollarSign}
            title={t("No bank fees in the last year")}
            body={t("Any overdraft, ATM, late or monthly service fee your bank charges shows here, with a request you can send to ask for it back.")}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card hero className="p-5 sm:p-6 lg:col-span-5">
          <div className="text-sm font-semibold text-[var(--on-hero-soft)]">{t("Lost to fees, last 12 months")}</div>
          <div className="mt-1 text-[56px] font-extrabold leading-none tracking-tight">{money0(lost)}</div>
          <p className="mt-3 text-sm text-[var(--on-hero-soft)]">
            {f.refunded12 > 0
              ? t("{paid} charged, {refunded} given back.", { paid: money(f.paid12), refunded: money(f.refunded12) })
              : f.fees.length === 1
                ? t("1 fee, none given back yet.")
                : t("{n} fees, none given back yet.", { n: f.fees.length })}
          </p>
        </Card>
        <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:col-span-7 lg:grid-cols-3">
          <Figure label={t("Since January")} value={money0(f.paidThisYear)} note={t("Charged in fees this year")} />
          <Figure label={t("Given back")} value={money0(f.refunded12)} note={refundedCount === 1 ? t("1 fee refunded") : t("{n} fees refunded", { n: refundedCount })} />
          <Figure
            label={t("Charged twice?")}
            value={String(f.doubles.length)}
            note={f.doubles.length ? t("Worth a look: see below") : t("None in the last 90 days")}
            className="col-span-2 lg:col-span-1"
          />
        </div>
      </div>

      {f.byKind.length ? (
        <Card className="p-5 sm:p-6">
          <CardHeader title={t("By kind")} subtitle={t("What each kind of fee cost you, after anything given back.")} />
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {f.byKind.map((k) => (
              <li key={k.kind} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink-1">{t(FEE_LABELS[k.kind])}</div>
                  <div className="text-xs text-ink-3">{k.count === 1 ? t("1 fee") : t("{n} fees", { n: k.count })}</div>
                </div>
                <div className="num shrink-0 text-sm font-bold text-ink-1">{money(k.lost)}</div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {f.fees.length ? (
        <Card className="p-5 sm:p-6">
          <CardHeader title={t("Every fee")} subtitle={t("Newest first. Asking costs nothing, and banks often give a fee back as a courtesy, especially a first one.")} />
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {f.fees.map((fee) => {
              const account = accountLabel(accounts.get(fee.accountId));
              return (
                <li key={fee.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-ink-1 [overflow-wrap:anywhere]">{fee.name}</div>
                      <div className="text-xs text-ink-3">
                        {t(FEE_LABELS[fee.kind])} · {shortDate(fee.date, locale)}
                        {account ? ` · ${account}` : ""}
                      </div>
                    </div>
                    <div className="num shrink-0 text-sm font-bold text-ink-1">{money(fee.amount)}</div>
                  </div>
                  <div className="mt-2">
                    {fee.refund ? (
                      <StatusPill status="good">{t("Given back {date}", { date: shortDate(fee.refund.date, locale) })}</StatusPill>
                    ) : (
                      <FeeRequest text={refundRequest(fee, account || t("ending as shown on my statement"), t)} label={t("Ask for the {amount} fee on {date} back", { amount: money(fee.amount), date: shortDate(fee.date, locale) })} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {f.doubles.length ? (
        <Card className="p-5 sm:p-6">
          <CardHeader title={t("Charged twice?")} subtitle={t("The same amount at the same place on the same day. That can be right; if you only meant to pay once, ask them to reverse one.")} />
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {f.doubles.map((d) => (
              <li key={d.ids.join("|")} className="flex items-start gap-3 py-3">
                <Copy aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-semibold text-ink-1 [overflow-wrap:anywhere]">{d.merchant}</div>
                  <div className="text-xs text-ink-3">
                    {t("{n} charges of {amount} on {date}", { n: d.ids.length, amount: money(d.amount), date: shortDate(d.date, locale) })}
                    {accounts.get(d.accountId) ? ` · ${accountLabel(accounts.get(d.accountId))}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
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
