// src/app/refunds/page.tsx — money on its way back to the person
// (finance/refunds.ts): refunds they're waiting on, found come back on their
// own, the late ones first; what friends owe them; money they may be owed and
// haven't asked for; and what came back this past year.
//
// Hero (the one --gradient-prism card): what's coming back, refunds and
// friends together. Late refunds, what came back this year and what may be
// owed sit beside it.
//
// Always the person's own (getPersonalFinance), like Subscriptions: what they
// say they're waiting on is theirs and never the household's.

import type { Metadata } from "next";
import { HandCoins } from "lucide-react";
import { OwedList } from "@/components/owed-list";
import { RefundsBoard } from "@/components/refunds";
import { ButtonLink, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { money, money0 } from "@/lib/finance/format";
import { analyze } from "@/lib/finance/model";
import type { Account } from "@/lib/finance/types";
import { getT } from "@/lib/i18n/server";
import { getPersonalFinance } from "@/lib/server/finance";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Refunds") };
}

function accountLabel(a: Account): string {
  return a.mask ? `${a.name} ••${a.mask}` : a.name;
}

export default async function RefundsPage() {
  const [data, t] = await Promise.all([getPersonalFinance(), getT()]);
  const r = analyze(data, t).refunds;
  const canEdit = data.account !== null && data.source !== "demo";
  const accounts = Object.fromEntries([...data.accounts, ...(data.hiddenAccounts ?? [])].map((a) => [a.id, accountLabel(a)]));
  const coming = r.waitingTotal + r.owedTotal;
  const maybe = r.suggestions.reduce((s, x) => s + x.amount, 0);
  const owedRows = r.owed.map(({ t: line, owed }) => ({ id: line.split?.of ?? line.id, who: owed.who, amount: owed.amount, merchant: line.merchant, date: line.date }));
  const header = <PageHeader title={t("Refunds")} subtitle={t("Money on its way back to you: returns, fees you asked back, and what friends owe you.")} />;

  if (!r.waiting.length && !r.owed.length && !r.suggestions.length && !r.back.length) {
    return (
      <div>
        {header}
        <Card>
          <EmptyState
            icon={HandCoins}
            title={t("Nothing coming back yet")}
            body={t("Returned something, or asked your bank for a fee back? Open the purchase in your transactions and choose Waiting on a refund, and Prism tells you when it comes in, or when it's late.")}
            action={<ButtonLink href="/spending">{t("See your transactions")}</ButtonLink>}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}

      {data.source === "demo" ? (
        <Card className="p-4 text-sm text-ink-2">
          {data.account
            ? t("This is the example household. Link a bank and the refunds you're waiting on show here.")
            : t("This is the example household. Sign in and link a bank to keep track of your own refunds.")}
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card hero className="p-5 sm:p-6 lg:col-span-5">
          <div className="text-sm font-semibold text-[var(--on-hero-soft)]">{t("Coming back to you")}</div>
          <div className="mt-1 text-[56px] font-extrabold leading-none tracking-tight">{money0(coming)}</div>
          <p className="mt-3 text-sm text-[var(--on-hero-soft)]">
            {r.owedTotal > 0
              ? t("{refunds} in refunds, {friends} from friends.", { refunds: money0(r.waitingTotal), friends: money0(r.owedTotal) })
              : r.waiting.length === 1
                ? t("1 refund you're waiting on.")
                : t("{n} refunds you're waiting on.", { n: r.waiting.length })}
          </p>
        </Card>
        <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:col-span-7 lg:grid-cols-3">
          <Figure label={t("Late")} value={String(r.late)} note={r.late ? t("Worth a call: see below") : t("None late")} />
          <Figure label={t("Back since January")} value={money0(r.backThisYear)} note={t("Refunds that came back this year")} />
          <Figure
            label={t("You might be owed")}
            value={money0(maybe)}
            note={r.suggestions.length ? t("Not asked for yet: see below") : t("Nothing found in the last 60 days")}
            className="col-span-2 lg:col-span-1"
          />
        </div>
      </div>

      <RefundsBoard waiting={r.waiting} suggestions={r.suggestions} back={r.back} accounts={accounts} canEdit={canEdit} />

      <Card className="p-5 sm:p-6">
        <CardHeader title={t("Friends who owe you")} subtitle={t("From purchases you marked. Remind writes a friendly nudge for you to send; Prism never sends it.")} />
        {canEdit ? (
          <OwedList rows={owedRows} empty={<p className="mt-3 text-sm text-ink-2">{t("Nobody owes you right now. Open a purchase and choose Someone owes me for this.")}</p>} />
        ) : owedRows.length ? (
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {owedRows.map((o) => (
              <li key={o.id} className="py-2.5 text-sm font-semibold text-ink-1">
                {t("{who} owes you {amount}", { who: o.who, amount: money(o.amount) })}
                <span className="block text-xs font-normal text-ink-3">{o.merchant}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink-2">{t("Nobody owes you right now. Open a purchase and choose Someone owes me for this.")}</p>
        )}
      </Card>

      {!data.account && data.accountsEnabled ? (
        <div className="flex justify-center">
          <ButtonLink href="/sign-in?next=/refunds">{t("Sign in to keep track of yours")}</ButtonLink>
        </div>
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
