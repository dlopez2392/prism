// src/app/subscriptions/page.tsx — everything the person pays for again and
// again (finance/subscriptions.ts): what it all costs, each one with where to
// cancel it, the ones they cancelled (and whether any charged again), the
// other repeating charges they can add to the list, and the ones Prism can't
// see, added by hand.
//
// Hero (the one --gradient-prism card): what subscriptions cost a month. That
// is the question the page answers first; the year, the next charge and what
// cancelling has saved sit beside it.
//
// Always the person's own (getPersonalFinance), like Connections: what they
// say about their subscriptions is theirs and never the household's.

import type { Metadata } from "next";
import { Smartphone } from "lucide-react";
import { SubscriptionsBoard } from "@/components/subscriptions";
import { ButtonLink, Card, CardHeader, PageHeader } from "@/components/ui";
import { plusFor } from "@/lib/billing/plus";
import { money, money0, shortDate } from "@/lib/finance/format";
import { analyze } from "@/lib/finance/model";
import { getT } from "@/lib/i18n/server";
import { getPersonalFinance } from "@/lib/server/finance";
import { currentAccount } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Subscriptions") };
}

export default async function SubscriptionsPage() {
  const [data, t, plus] = await Promise.all([getPersonalFinance(), getT(), currentAccount().then(plusFor)]);
  const { locale } = t;
  const s = analyze(data, t).subscriptions;
  const canEdit = data.account !== null && data.source !== "demo";
  const n = s.active.length;
  // The list is most expensive first.
  const top = s.active[0];
  const next = [...s.active].sort((a, b) => (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : 0))[0];
  const saved = s.cancelled.reduce((sum, c) => sum + c.yearly, 0);
  const caught = s.cancelled.filter((c) => c.chargedSince.length > 0).length;

  return (
    <div className="space-y-5">
      <PageHeader title={t("Subscriptions")} subtitle={t("Everything you pay for again and again, what it all costs, and where to cancel.")} />

      {data.source === "demo" ? (
        <Card className="p-4 text-sm text-ink-2">
          {data.account
            ? t("This is the example household. Link a bank and your own subscriptions show here.")
            : t("This is the example household. Sign in and link a bank to see your own subscriptions.")}
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card hero className="p-5 sm:p-6 lg:col-span-5">
          <div className="text-sm font-semibold text-[var(--on-hero-soft)]">{t("Your subscriptions cost")}</div>
          <div className="mt-1 text-[56px] font-extrabold leading-none tracking-tight">{money0(s.monthly)}</div>
          <p className="mt-3 text-sm text-[var(--on-hero-soft)]">
            {n === 1 ? t("A month, for 1 subscription. That's {yearly} a year.", { yearly: money0(s.yearly) }) : t("A month, for {n} subscriptions. That's {yearly} a year.", { n, yearly: money0(s.yearly) })}
          </p>
        </Card>
        <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:col-span-7 lg:grid-cols-3">
          <Figure label={t("Costs the most")} value={top ? money0(top.yearly) : "—"} note={top ? t("{name}, a year", { name: top.name }) : t("Nothing yet")} />
          <Figure
            label={t("Next charge")}
            value={next ? money(next.amount) : "—"}
            note={next ? t("{name}, {date}", { name: next.name, date: shortDate(next.nextDate, locale) }) : t("Nothing coming up")}
          />
          <Figure
            label={t("Saved by cancelling")}
            value={money0(saved)}
            note={
              s.cancelled.length === 0
                ? t("Cancel one and say so, and what it saves shows here")
                : caught
                  ? caught === 1
                    ? t("A year. 1 charged you again: see below")
                    : t("A year. {n} charged you again: see below", { n: caught })
                  : t("A year, from what you cancelled")
            }
            className="col-span-2 lg:col-span-1"
          />
        </div>
      </div>

      {s.appStores.length ? (
        <Card className="p-5 sm:p-6">
          <CardHeader
            title={t("Some are billed through your phone")}
            subtitle={t("Apple and Google bill for other apps' subscriptions under their own name, so the bank can't say which app each charge is for.")}
          />
          <ul className="mt-3 space-y-3">
            {s.appStores.map((a) => (
              <li key={a.store} className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-ctl bg-accent-soft text-accent">
                  <Smartphone aria-hidden className="size-[18px]" />
                </span>
                <div className="min-w-0 text-sm">
                  <div className="font-semibold text-ink-1">
                    {a.store === "apple"
                      ? a.charges === 1
                        ? t("Apple billed you once in the last month: {total}", { total: money(a.total) })
                        : t("Apple billed you {n} times in the last month: {total} in all", { n: a.charges, total: money(a.total) })
                      : a.charges === 1
                        ? t("Google billed you once in the last month: {total}", { total: money(a.total) })
                        : t("Google billed you {n} times in the last month: {total} in all", { n: a.charges, total: money(a.total) })}
                  </div>
                  <p className="text-ink-3">
                    {a.store === "apple"
                      ? t("To see which apps they're for, open Settings on your iPhone or iPad, tap your name, then Subscriptions.")
                      : t("To see which apps they're for, open the Google Play Store app, tap your profile picture, then Payments & subscriptions, then Subscriptions.")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <SubscriptionsBoard active={s.active} cancelled={s.cancelled} others={s.others} own={data.subscriptionNotes?.own ?? []} canEdit={canEdit} plus={plus.plus} />

      {!data.account && data.accountsEnabled ? (
        <div className="flex justify-center">
          <ButtonLink href="/sign-in?next=/subscriptions">{t("Sign in to keep track of yours")}</ButtonLink>
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
