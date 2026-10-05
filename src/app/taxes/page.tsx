// src/app/taxes/page.tsx — one year's money sorted into what a tax return
// asks about (finance/taxes.ts): pay, interest, dividends and other money in;
// gifts, medical bills, taxes paid, mortgage and student-loan payments,
// childcare and tuition going out. Each section names the form that holds the
// official figure and shows the transactions behind it, one tap away. Print
// it, or download it for whoever does the return.
//
// Hero (the one --gradient-prism card): the forms to watch for. That's the
// job of the page at tax time: know what's coming, then check it against what
// the bank saw. Nothing here adds up a deduction or guesses a tax.

import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { ChevronRight, Download, FileCheck2, ReceiptText } from "lucide-react";
import { buttonGhost } from "@/components/dialog";
import { PrintButton } from "@/components/print-button";
import { ButtonLink, Card, CardHeader, EmptyState, PageHeader, Pill } from "@/components/ui";
import { dayDate, money, shortDate } from "@/lib/finance/format";
import { p2pLabel } from "@/lib/finance/p2p";
import { defaultTaxYear, GIFT_RECEIPT_FROM, TAX_SECTIONS, taxSummary, taxYears, type TaxSection } from "@/lib/finance/taxes";
import type { Account, Transaction } from "@/lib/finance/types";
import { getFinance } from "@/lib/server/finance";

export const metadata: Metadata = { title: "Taxes" };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function accountLabel(a: Account | undefined) {
  if (!a) return null;
  return a.mask ? `${a.name} ••${a.mask}` : a.name;
}

function Line({ t, account, receipt }: { t: Transaction; account: string | null; receipt: boolean }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="font-semibold text-ink-1">{t.merchant}</div>
        <div className="text-xs text-ink-3">
          <span className="num">{shortDate(t.date)}</span>
          {t.p2p ? ` · ${p2pLabel(t.p2p)}${t.p2p.note ? ` · ${t.p2p.note}` : ""}` : ""}
          {account ? ` · ${account}` : ""}
        </div>
        {receipt ? (
          <div className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-ink-2">
            <FileCheck2 aria-hidden className="size-3.5" />
            Keep the charity&apos;s receipt
          </div>
        ) : null}
      </div>
      <span className={clsx("num shrink-0 font-bold", t.amount > 0 ? "text-good-ink" : "text-ink-1")}>
        {t.amount > 0 ? "+" : ""}
        {money(t.amount)}
      </span>
    </li>
  );
}

function Section({ s, accounts }: { s: TaxSection; accounts: Map<string, Account> }) {
  const big = s.id === "gifts" ? s.lines.filter((t) => -t.amount >= GIFT_RECEIPT_FROM).length : 0;
  return (
    <Card as="article" className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-ink-1">{s.title}</h3>
          <p className="text-xs text-ink-3">
            {plural(s.lines.length, "transaction", "transactions")}
            {big ? ` · ${plural(big, "gift", "gifts")} of $250 or more` : ""}
          </p>
        </div>
        <div className="text-right">
          <div className="num text-xl font-extrabold tracking-tight text-ink-1">{money(s.total)}</div>
          {s.form ? <div className="text-xs font-semibold text-ink-2">Form {s.form}</div> : null}
        </div>
      </div>
      <p className="mt-3 text-sm text-ink-2">{s.note}</p>
      <details className="group mt-3">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-accent-ink">
          <ChevronRight aria-hidden className="size-3.5 transition-transform duration-150 group-open:rotate-90" />
          Show the {s.lines.length === 1 ? "transaction" : `${s.lines.length} transactions`}
        </summary>
        <ul className="mt-2 max-h-80 divide-y divide-line overflow-auto rounded-ctl bg-surface-2 px-3">
          {s.lines.map((t) => (
            <Line key={t.id} t={t} account={accountLabel(accounts.get(t.accountId))} receipt={s.id === "gifts" && -t.amount >= GIFT_RECEIPT_FROM} />
          ))}
        </ul>
      </details>
    </Card>
  );
}

export default async function TaxesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const data = await getFinance();
  const years = taxYears(data);
  const raw = (await searchParams).y;
  const asked = typeof raw === "string" && /^\d{4}$/.test(raw) ? Number(raw) : null;
  const year = asked !== null && years.includes(asked) ? asked : defaultTaxYear(data);
  const s = taxSummary(data, year);
  const accounts = new Map([...data.accounts, ...(data.hiddenAccounts ?? [])].map((a) => [a.id, a]));
  // Only a signed-in person's own money can be downloaded; the example household and a household view can't.
  const canDownload = data.account !== null && data.source !== "demo" && data.view === "me";
  const moneyIn = s.sections.filter((x) => x.side === "in");
  const moneyOut = s.sections.filter((x) => x.side === "out");
  const forms = [...new Set(s.sections.flatMap((x) => (x.form ? x.form.split(/,\s*|\s+or\s+/) : [])))];

  const tabs =
    years.length > 1 ? (
      <nav aria-label="Tax year" className="inline-flex rounded-ctl border border-line bg-surface-1 p-1 shadow-card print:hidden">
        {years.slice(0, 3).map((y) => (
          <Link
            key={y}
            href={`/taxes?y=${y}`}
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

  const header = (
    <PageHeader
      eyebrow={s.partial ? `${year} so far · ${shortDate(s.from)} – ${shortDate(s.to)}` : `${shortDate(s.from)} – Dec 31, ${year}`}
      title={`Your ${year} taxes`}
      subtitle="What your accounts saw that a tax return asks about, and the form that has the official figure."
      action={tabs}
    />
  );

  if (s.transactions === 0) {
    return (
      <div className="space-y-5">
        {header}
        <Card className="p-5 sm:p-6">
          <EmptyState
            icon={ReceiptText}
            title={`Nothing from ${year} yet`}
            body="Your interest, gifts to charity, medical bills and more are gathered here for tax time once Prism has your transactions: link a bank, or import your history."
            action={
              <ButtonLink href="/connections" variant="primary">
                Go to Connections
              </ButtonLink>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}

      {s.recordsFrom ? (
        <p className="rounded-ctl border border-line bg-surface-1 px-4 py-3 text-sm text-ink-2">
          Prism&apos;s records start on {dayDate(s.recordsFrom)}, so anything earlier in {year} isn&apos;t here. Import older history on Connections to fill it in.
        </p>
      ) : null}
      {data.view === "household" ? (
        <p className="rounded-ctl border border-line bg-surface-1 px-4 py-3 text-sm text-ink-2">
          This is your household&apos;s shared money. If you file on your own, switch to Me for just yours.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:gap-5 md:grid-cols-3">
        <Card hero className="p-5 md:col-span-2">
          <div className="text-sm font-semibold text-[var(--on-hero-soft)]">Found for your {year} return</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[44px] font-extrabold leading-none tracking-tight">{s.sections.length}</span>
            <span className="text-sm text-[var(--on-hero-soft)]">of {TAX_SECTIONS.length} things a return asks about</span>
          </div>
          <p className="mt-2 text-sm text-[var(--on-hero-soft)]">
            {forms.length ? "Forms to watch for:" : "No forms to watch for from what Prism can see."}
          </p>
          {forms.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {forms.map((f) => (
                <li key={f} className="rounded-pill bg-[var(--on-hero-faint)] px-2.5 py-1 text-xs font-bold text-[var(--on-hero)]">
                  {f}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
        <Card className="p-5">
          <div className="text-sm font-semibold text-ink-2">Counted</div>
          <div className="mt-1 text-[28px] font-extrabold leading-none tracking-tight text-ink-1">{s.transactions.toLocaleString("en-US")}</div>
          <p className="mt-2 text-sm text-ink-2">transactions, {s.partial ? `${shortDate(s.from)} to today` : `${shortDate(s.from)} – Dec 31`}.</p>
          {s.partial ? <p className="mt-1 text-xs text-ink-3">{year} isn&apos;t over, so these will grow until December 31.</p> : null}
        </Card>
      </div>

      {moneyIn.length ? (
        <section aria-labelledby="money-in" className="space-y-3">
          <h2 id="money-in" className="text-sm font-bold uppercase tracking-[0.08em] text-ink-3">
            Money in
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:gap-5 lg:grid-cols-2">
            {moneyIn.map((x) => (
              <Section key={x.id} s={x} accounts={accounts} />
            ))}
          </div>
        </section>
      ) : null}

      {moneyOut.length ? (
        <section aria-labelledby="money-out" className="space-y-3">
          <h2 id="money-out" className="text-sm font-bold uppercase tracking-[0.08em] text-ink-3">
            Money out that may count
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:gap-5 lg:grid-cols-2">
            {moneyOut.map((x) => (
              <Section key={x.id} s={x} accounts={accounts} />
            ))}
          </div>
        </section>
      ) : null}

      <Card className="p-5 sm:p-6">
        <CardHeader title="Not found" subtitle="Prism looked and saw none of these" />
        {s.nothing.length ? (
          <>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {s.nothing.map((n) => (
                <li key={n.id}>
                  <Pill>{n.title}</Pill>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-ink-2">If you had any, paid by check or cash, or from an account that isn&apos;t linked, add them from your own records.</p>
          </>
        ) : (
          <p className="mt-3 text-sm text-ink-2">Prism found something for every part of a return it looks for.</p>
        )}
        {s.political.length ? (
          <p className="mt-3 text-sm text-ink-2">
            Left out: {plural(s.political.length, "gift", "gifts")} to a campaign or a party ({money(-s.political.reduce((sum, t) => sum + t.amount, 0))}). Those aren&apos;t deductible.
          </p>
        ) : null}
      </Card>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        {canDownload ? (
          <a href={`/account/export/taxes.csv?year=${year}`} className={buttonGhost}>
            <Download aria-hidden className="size-4" />
            Download for your tax preparer
          </a>
        ) : null}
        <PrintButton />
      </div>
      <p className="text-xs text-ink-3">
        Information, not tax advice. Prism finds these by your bank&apos;s categories and by name, and a bank line is what landed, not what a form says: trust the forms, and check each line against your own records.
      </p>
    </div>
  );
}
