// src/app/business/page.tsx — the person's business accounts, a year at a
// time, every line sorted by where it goes on Schedule C
// (finance/schedule-c.ts): money in, the costs line by line, and what isn't
// on the form at all (what the person paid themselves or put in, and what
// wasn't the business's). Each line can be moved, alone or with every line
// from its shop; Prism's guesses say so until the person has looked.
//
// Hero (the one --gradient-prism card): what the business kept, as its
// accounts saw it.
//
// Always the person's own (getPersonalFinance): which accounts are their
// business, and where its money goes, is theirs and never the household's.
// Part of Prism Plus with the rest of the tax year.

import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { Briefcase } from "lucide-react";
import { BusinessSort, type BizGroup } from "@/components/business-sort";
import { PlusCard } from "@/components/plus";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { money0, shortDate, signedMoney0 } from "@/lib/finance/format";
import { BIZ_LINE_INFO, bizLineLabel, scheduleC, type BizTxn, type ScheduleC } from "@/lib/finance/schedule-c";
import { defaultTaxYear } from "@/lib/finance/taxes";
import type { Account } from "@/lib/finance/types";
import { plusFor } from "@/lib/billing/plus";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/t";
import { getPersonalFinance } from "@/lib/server/finance";
import { currentAccount } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Your business") };
}

function accountLabel(a: Account | undefined): string | null {
  if (!a) return null;
  return a.mask ? `${a.name} ••${a.mask}` : a.name;
}

/** The groups on the page, in the form's order: money in, then the costs, then what isn't on the form. */
function groupsOf(s: ScheduleC, accounts: Map<string, Account>, t: T): { income: BizGroup[]; costs: BizGroup[]; apart: BizGroup[] } {
  const rows = (lines: BizTxn[]) =>
    lines.map((x) => ({ id: x.id, merchant: x.merchant, date: x.date, amount: x.amount, account: accountLabel(accounts.get(x.accountId)), biz: x.biz, how: x.how, side: x.side, own: x.own, shop: x.shop }));
  const group = (id: string, title: string, lines: BizTxn[], total: number, note?: string): BizGroup[] => (lines.length ? [{ id, title, total, rows: rows(lines), ...(note ? { note } : {}) }] : []);
  const sales = s.lines.filter((x) => x.biz === "sales" && x.side === "in");
  const refunds = s.lines.filter((x) => x.biz === "sales" && x.side === "out");
  const other = s.lines.filter((x) => x.biz === "other-income");
  const paid = s.owner.lines.filter((x) => x.amount < 0);
  const putIn = s.owner.lines.filter((x) => x.amount > 0);
  return {
    income: [
      ...group("sales", bizLineLabel("sales", t), sales, s.receipts),
      ...group("refunds", bizLineLabel("sales", t, "out"), refunds, s.returns),
      ...group("other-income", bizLineLabel("other-income", t), other, s.otherIncome),
    ],
    costs: s.costs.map((c) => ({
      id: c.id,
      title: bizLineLabel(c.id, t),
      total: c.total,
      rows: rows(c.lines),
      ...(c.id === "meals" ? { note: t("Usually only half of a business meal counts. The total here is all of it.") } : {}),
      ...(c.id === "goods" ? { note: t("What you bought to sell or to make what you sell. Your preparer works out what was used up this year.") } : {}),
    })),
    apart: [
      ...group("owner-out", t("Paid to you"), paid, -paid.reduce((n, x) => n + x.amount, 0), t("Money you took out for yourself, your own income tax included. It isn't a business cost.")),
      ...group("owner-in", t("Put in by you"), putIn, putIn.reduce((n, x) => n + x.amount, 0), t("Money you moved in from your own accounts. It isn't income.")),
      ...group("personal", t(BIZ_LINE_INFO.personal.title), s.personal.lines, s.personal.total, t("Personal spending from a business account. It isn't a business cost.")),
    ],
  };
}

export default async function BusinessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [data, t, plus] = await Promise.all([getPersonalFinance(), getT(), currentAccount().then(plusFor)]);
  const { locale } = t;
  const subtitle = t("Every line in your business accounts, sorted by where it goes on Schedule C, the form a sole proprietor or single-member LLC reports its profit on.");
  if (data.source !== "demo" && !plus.plus) {
    return (
      <div className="space-y-5">
        <PageHeader title={t("Your business")} subtitle={subtitle} />
        <PlusCard feature="taxes" trial={plus.trial} t={t} />
      </div>
    );
  }
  const ids = new Set(data.businessAccountIds ?? []);
  const years = [...new Set(data.transactions.filter((x) => ids.has(x.accountId) && x.date <= data.today).map((x) => Number(x.date.slice(0, 4))))].sort((a, b) => b - a);
  const raw = (await searchParams).y;
  const asked = typeof raw === "string" && /^\d{4}$/.test(raw) ? Number(raw) : null;
  const fallback = defaultTaxYear(data);
  const year = asked !== null && years.includes(asked) ? asked : years.includes(fallback) || !years.length ? fallback : years[0]!;
  const s = scheduleC(data, year, t);
  const canEdit = data.account !== null && data.source !== "demo";

  const tabs =
    years.length > 1 ? (
      <nav aria-label={t("Tax year")} className="inline-flex rounded-ctl border border-line bg-surface-1 p-1 shadow-card">
        {years.slice(0, 3).map((y) => (
          <Link
            key={y}
            href={`/business?y=${y}`}
            scroll={false}
            aria-current={y === year ? "true" : undefined}
            className={clsx(
              "rounded-[calc(var(--radius-ctl)-4px)] px-3 py-1.5 text-xs font-bold transition-colors duration-150",
              y === year ? "bg-button text-ink-on-accent" : "text-ink-2 hover:bg-surface-3 hover:text-ink-1",
            )}
          >
            {y}
          </Link>
        ))}
      </nav>
    ) : null;

  if (!s) {
    return (
      <div className="space-y-5">
        <PageHeader title={t("Your business")} subtitle={subtitle} />
        <Card>
          <EmptyState
            icon={Briefcase}
            title={t("No business accounts yet")}
            body={t("Mark an account as your business on Net worth, under Choose what counts, and its money is sorted here by where it goes on Schedule C.")}
            action={<ButtonLink href="/net-worth">{t("Go to Net worth")}</ButtonLink>}
          />
        </Card>
      </div>
    );
  }

  const header = (
    <PageHeader
      eyebrow={
        s.partial
          ? t("{year} so far · {from} – {to}", { year, from: shortDate(s.from, locale), to: shortDate(s.to, locale) })
          : t("{from} – {to}, {year}", { from: shortDate(s.from, locale), to: shortDate(`${year}-12-31`, locale), year })
      }
      title={t("Your {year} business", { year })}
      subtitle={subtitle}
      action={tabs}
    />
  );

  if (!s.lines.length) {
    return (
      <div className="space-y-5">
        {header}
        <Card>
          <EmptyState
            icon={Briefcase}
            title={t("Nothing from your business accounts in {year}", { year })}
            body={t("Once money comes in or goes out of a business account, it's sorted here by where it goes on Schedule C.")}
            action={<ButtonLink href="/connections">{t("Go to Connections")}</ButtonLink>}
          />
        </Card>
      </div>
    );
  }

  const accounts = new Map([...data.accounts, ...(data.hiddenAccounts ?? [])].map((a) => [a.id, a]));
  const g = groupsOf(s, accounts, t);
  const income = s.receipts - s.returns + s.otherIncome;

  return (
    <div className="space-y-5">
      {header}

      <div className="grid grid-cols-1 gap-3 sm:gap-5 md:grid-cols-3">
        <Card hero className="p-5 md:col-span-2">
          <div className="text-sm font-semibold text-[var(--on-hero-soft)]">{s.partial ? t("What the business kept, {year} so far", { year }) : t("What the business kept in {year}", { year })}</div>
          <div className="mt-1 text-[44px] font-extrabold leading-none tracking-tight">{signedMoney0(s.net)}</div>
          <p className="mt-2 text-sm text-[var(--on-hero-soft)]">{t("{income} came in and {costs} went to costs, as your accounts saw it.", { income: money0(income), costs: money0(s.costsTotal) })}</p>
        </Card>
        <Card className="p-5">
          <div className="text-sm font-semibold text-ink-2">{t("Paid to you")}</div>
          <div className="num mt-1 text-[28px] font-extrabold leading-none tracking-tight text-ink-1">{money0(s.owner.out)}</div>
          <p className="mt-2 text-sm text-ink-2">{s.owner.in > 0 ? t("And {amount} put in by you. Neither is on Schedule C.", { amount: money0(s.owner.in) }) : t("Money you took out for yourself isn't on Schedule C.")}</p>
        </Card>
      </div>

      {s.guessed ? (
        <p className="rounded-ctl border border-line bg-surface-1 px-4 py-3 text-sm text-ink-2">
          {s.guessed === 1
            ? t("Prism sorted 1 line by its own guess. Check it below: move it, and every line from the same place can follow.")
            : t("Prism sorted {n} lines by its own guess. Check them below: move one, and every line from the same place can follow.", { n: s.guessed.toLocaleString("en-US") })}
        </p>
      ) : null}

      <BusinessSort
        canEdit={canEdit}
        sections={[
          ...(g.income.length ? [{ id: "in", title: t("Money in"), groups: g.income }] : []),
          ...(g.costs.length ? [{ id: "costs", title: t("Costs"), total: s.costsTotal, groups: g.costs }] : []),
          ...(g.apart.length ? [{ id: "apart", title: t("Not on Schedule C"), groups: g.apart }] : []),
        ]}
      />

      <p className="text-xs text-ink-3">
        {t(
          "Information, not tax advice. These are what your business accounts saw, not the form's own figures: a meal usually counts at half, and what Prism can't see (a home office, miles in your own car, equipment that's depreciated) is for you or your preparer to add. The full summary is on Taxes.",
        )}
      </p>
    </div>
  );
}
