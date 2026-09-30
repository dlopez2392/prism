"use client";

// src/components/import-history.tsx
//
// Import history from a CSV file, in three steps: choose the file, match its
// columns, and say where each account's history belongs. The file is read
// here, in the browser, and never uploaded; only the rows it maps are sent,
// a batch at a time, and the server checks every one again
// (src/lib/server/import-actions.ts). Each account in the file becomes one
// import, which can be removed from Connections at any time.

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileUp, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { buttonGhost, buttonPrimary, SelectInput, TextInput } from "@/components/dialog";
import { Card, CardHeader, StatusPill } from "@/components/ui";
import { categoryLabel } from "@/lib/finance/categories";
import { money, monthYear, shortDate } from "@/lib/finance/format";
import {
  detectColumns,
  IMPORT_KINDS,
  IMPORT_LIMITS,
  mapIsUsable,
  mapRows,
  parseCsv,
  type ColumnMap,
  type ImportKind,
  type ImportRow,
  type ImportSource,
  type MappedRow,
  type Skipped,
} from "@/lib/finance/import";
import type { ISODate } from "@/lib/finance/types";
import { finishImport, saveImportPart } from "@/lib/server/import-actions";

/** A bank account the person has linked, and the day its own history starts. */
export type LinkedAccount = { id: string; name: string; mask: string | null; since: ISODate | null };

type Plan = { label: string; name: string; target: string; kind: ImportKind };

type Step =
  | { kind: "choose"; error: string | null }
  | { kind: "match"; fileName: string; header: string[]; body: string[][]; source: ImportSource; map: ColumnMap }
  | { kind: "accounts"; fileName: string; source: ImportSource; rows: MappedRow[]; skipped: Skipped[]; plans: Plan[] }
  | { kind: "saving"; done: number; total: number }
  | { kind: "done"; accounts: number; rows: number }
  | { kind: "failed"; message: string };

const SOURCE_NAME: Record<ImportSource, string> = { mint: "a Mint export", monarch: "a Monarch export", csv: "a spreadsheet" };
const KIND_LABEL: Record<ImportKind, string> = { checking: "Checking", savings: "Savings", credit: "Credit card", loan: "Loan" };
const OWN = "own";

/** "1 transaction", "2,450 transactions". */
const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const label = (a: LinkedAccount) => `${a.name}${a.mask ? ` ·· ${a.mask}` : ""}`;
const guessKind = (name: string): ImportKind => (/card|visa|mastercard|amex|discover|credit/i.test(name) ? "credit" : /saving/i.test(name) ? "savings" : /loan|mortgage/i.test(name) ? "loan" : "checking");

/** A linked account whose name or last four digits appear in the file's account name. */
function likelyMatch(fileName: string, linked: LinkedAccount[]): string {
  const f = fileName.toLowerCase();
  const hit = linked.find((a) => (a.mask && f.includes(a.mask)) || f.includes(a.name.toLowerCase()) || a.name.toLowerCase().includes(f));
  return hit?.id ?? OWN;
}

export function ImportHistory({ linked, today }: { linked: LinkedAccount[]; today: ISODate }) {
  const [step, setStep] = useState<Step>({ kind: "choose", error: null });
  const input = useRef<HTMLInputElement>(null);

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    if (file.size > IMPORT_LIMITS.fileBytes) return setStep({ kind: "choose", error: "That file is over 20 MB, which is more than any transaction export. Choose the CSV of your transactions." });
    let text: string;
    try {
      text = await file.text();
    } catch {
      return setStep({ kind: "choose", error: "That file couldn't be read. Choose it again, or save it as CSV first." });
    }
    const all = parseCsv(text);
    if (all.length < 2) return setStep({ kind: "choose", error: "That file has no rows Prism can read. Choose a CSV with a header row and at least one transaction." });
    if (all.length > IMPORT_LIMITS.rows + 1) return setStep({ kind: "choose", error: `That file has more than ${IMPORT_LIMITS.rows.toLocaleString("en-US")} rows. Split it into smaller files and import each.` });
    const [header, ...body] = all;
    const { source, map } = detectColumns(header!);
    setStep({ kind: "match", fileName: file.name, header: header!, body, source, map });
  }

  function toAccounts(s: Extract<Step, { kind: "match" }>) {
    const { rows, skipped } = mapRows(s.body, s.map, today);
    const labels = [...new Set(rows.map((r) => r.account))];
    const plans = labels.map((l) => ({ label: l, name: l, target: likelyMatch(l, linked), kind: guessKind(l) }));
    setStep({ kind: "accounts", fileName: s.fileName, source: s.source, rows, skipped, plans });
  }

  async function save(s: Extract<Step, { kind: "accounts" }>) {
    const jobs = s.plans
      .map((p) => {
        const target = p.target === OWN ? null : (linked.find((a) => a.id === p.target) ?? null);
        const rows = s.rows.filter((r) => r.account === p.label && (!target?.since || r.date < target.since)).map(({ date, amount, merchant, category }): ImportRow => ({ date, amount, merchant, category }));
        return { plan: p, target, rows };
      })
      .filter((j) => j.rows.length > 0);
    const total = jobs.reduce((n, j) => n + j.rows.length, 0);
    let done = 0;
    setStep({ kind: "saving", done, total });
    for (const job of jobs) {
      const importId = crypto.randomUUID();
      const batches: ImportRow[][] = [];
      for (let i = 0; i < job.rows.length; i += IMPORT_LIMITS.batch) batches.push(job.rows.slice(i, i + IMPORT_LIMITS.batch));
      if (batches.length > IMPORT_LIMITS.parts) return setStep({ kind: "failed", message: `${job.plan.name} has more rows than one import holds. Split the file and import each part.` });
      // Every later part first; the first part, which says what the import is, last: only then does it show.
      for (let n = 1; n < batches.length; n++) {
        const r = await saveImportPart(importId, n, batches[n]);
        if (!r.ok) return setStep({ kind: "failed", message: r.message });
        done += batches[n]!.length;
        setStep({ kind: "saving", done, total });
      }
      const meta = { name: job.plan.name.trim().slice(0, IMPORT_LIMITS.account) || "Imported account", kind: job.plan.kind, attachTo: job.target?.id ?? null, source: s.source, parts: batches.length };
      const r = await finishImport(importId, meta, batches[0]);
      if (!r.ok) return setStep({ kind: "failed", message: r.message });
      done += batches[0]!.length;
      setStep({ kind: "saving", done, total });
    }
    setStep({ kind: "done", accounts: jobs.length, rows: total });
  }

  return (
    <div className="space-y-5">
      <Steps current={step.kind === "choose" ? 0 : step.kind === "match" ? 1 : 2} />
      {step.kind === "choose" ? (
        <Card className="p-5 sm:p-6">
          <CardHeader title="Choose a file" subtitle="A Mint or Monarch export, or any spreadsheet saved as CSV with a date, a description and an amount for each transaction." />
          <div className="mt-4 flex flex-col items-start gap-3">
            <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => chooseFile(e.currentTarget.files?.[0])} />
            <button type="button" className={buttonPrimary} onClick={() => input.current?.click()}>
              <FileUp aria-hidden className="size-4" />
              Choose a CSV file
            </button>
            <p className="text-xs text-ink-3">The file is read in your browser and never uploaded. Only the transactions you import are saved, encrypted, in your account.</p>
            {step.error ? (
              <p role="alert" className="text-sm font-medium text-crit-ink">
                {step.error}
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {step.kind === "match" ? <MatchColumns step={step} today={today} onChange={(map) => setStep({ ...step, map })} onBack={() => setStep({ kind: "choose", error: null })} onNext={() => toAccounts(step)} /> : null}

      {step.kind === "accounts" ? (
        <ChooseAccounts step={step} linked={linked} onChange={(plans) => setStep({ ...step, plans })} onBack={() => setStep({ kind: "choose", error: null })} onSave={(plans) => save({ ...step, plans })} />
      ) : null}

      {step.kind === "saving" ? (
        <Card className="p-5 sm:p-6" aria-busy="true">
          <CardHeader title="Importing" subtitle={`${step.done.toLocaleString("en-US")} of ${count(step.total, "transaction", "transactions")} saved. Keep this page open.`} />
          <div className="mt-4 h-2 overflow-hidden rounded-pill bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={step.total} aria-valuenow={step.done} aria-label="Transactions saved">
            <div className="h-full rounded-pill bg-accent transition-[width] duration-150" style={{ width: `${step.total ? Math.round((step.done / step.total) * 100) : 0}%` }} />
          </div>
        </Card>
      ) : null}

      {step.kind === "done" ? (
        <Card className="p-5 sm:p-6">
          <div role="status" className="flex items-start gap-3">
            <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-good" />
            <div>
              <h2 className="text-lg font-bold text-ink-1">
                {count(step.rows, "transaction", "transactions")} imported from {count(step.accounts, "account", "accounts")}
              </h2>
              <p className="mt-1 text-sm text-ink-2">They count on every screen now. Fix any category on Spending, and remove an import on Connections whenever you like.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href="/spending" className={buttonPrimary}>
                  See your spending
                </Link>
                <Link href="/connections" className={buttonGhost}>
                  Back to Connections
                </Link>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {step.kind === "failed" ? (
        <Card className="p-5 sm:p-6">
          <div role="alert" className="flex items-start gap-3">
            <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" />
            <div>
              <h2 className="text-lg font-bold text-ink-1">The import didn&apos;t finish</h2>
              <p className="mt-1 text-sm text-ink-2">{step.message} Anything half-saved isn&apos;t shown, and is cleared within a day.</p>
              <button type="button" className={clsx(buttonPrimary, "mt-4")} onClick={() => setStep({ kind: "choose", error: null })}>
                Start again
              </button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Steps({ current }: { current: number }) {
  const names = ["Choose a file", "Match the columns", "Check the accounts"];
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Import steps">
      {names.map((n, i) => (
        <li key={n} aria-current={i === current ? "step" : undefined} className={clsx("flex items-center gap-2 font-semibold", i === current ? "text-ink-1" : "text-ink-3")}>
          <span className={clsx("grid size-6 place-items-center rounded-pill text-xs", i < current ? "bg-accent text-ink-on-accent" : i === current ? "bg-accent-soft text-accent" : "bg-surface-2")}>{i + 1}</span>
          {n}
        </li>
      ))}
    </ol>
  );
}

function MatchColumns({
  step,
  today,
  onChange,
  onBack,
  onNext,
}: {
  step: Extract<Step, { kind: "match" }>;
  today: ISODate;
  onChange: (map: ColumnMap) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { header, body, map, source } = step;
  const columns = [{ value: "", label: "Not in this file" }, ...header.map((h, i) => ({ value: String(i), label: h.trim() || `Column ${i + 1}` }))];
  const set = (field: keyof ColumnMap) => (v: string) => onChange({ ...map, [field]: v === "" ? null : Number(v) });
  const value = (i: number | null) => (i === null ? "" : String(i));
  const split = map.amount === null;
  const preview = useMemo(() => mapRows(body, map, today), [body, map, today]);
  const usable = mapIsUsable(map) && preview.rows.length > 0;

  return (
    <Card className="p-5 sm:p-6">
      <CardHeader title="Match the columns" subtitle={`${step.fileName} looks like ${SOURCE_NAME[source]}. Check each column is the right one.`} />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <SelectInput key={`d${source}`} name="date" label="Date" showLabel options={columns} defaultValue={value(map.date)} onChange={set("date")} />
        <SelectInput key={`m${source}`} name="merchant" label="Description" showLabel options={columns} defaultValue={value(map.merchant)} onChange={set("merchant")} />
        {split ? (
          <>
            <SelectInput key="out" name="debit" label="Money out" showLabel options={columns} defaultValue={value(map.debit)} onChange={set("debit")} />
            <SelectInput key="in" name="credit" label="Money in" showLabel options={columns} defaultValue={value(map.credit)} onChange={set("credit")} />
          </>
        ) : (
          <SelectInput key={`a${source}`} name="amount" label="Amount" showLabel options={columns} defaultValue={value(map.amount)} onChange={set("amount")} />
        )}
        <SelectInput key={`c${source}`} name="category" label="Category (optional)" showLabel options={columns} defaultValue={value(map.category)} onChange={set("category")} />
        <SelectInput key={`acct${source}`} name="account" label="Account (optional)" showLabel options={columns} defaultValue={value(map.account)} onChange={set("account")} />
        {!split && map.type === null ? (
          <SelectInput
            key={`sign${source}`}
            name="sign"
            label="Money out is written as"
            showLabel
            options={[
              { value: "neg", label: "A negative number (−12.50)" },
              { value: "pos", label: "A positive number (12.50)" },
            ]}
            defaultValue={map.outIsNegative ? "neg" : "pos"}
            onChange={(v) => onChange({ ...map, outIsNegative: v === "neg" })}
          />
        ) : null}
      </div>
      <button type="button" className="mt-3 text-xs font-semibold text-accent-ink hover:underline" onClick={() => onChange({ ...map, amount: split ? (map.debit ?? 0) : null, debit: split ? null : map.debit, credit: split ? null : map.credit })}>
        {split ? "The amount is in one column instead" : "Money out and money in are in separate columns"}
      </button>

      <div className="mt-5">
        <div className="text-[13px] font-semibold text-ink-2">
          {count(preview.rows.length, "transaction", "transactions")} read
          {preview.skipped.length ? `, ${count(preview.skipped.length, "row", "rows")} left out` : ""}
        </div>
        {preview.rows.length ? (
          <div className="mt-2 overflow-x-auto rounded-ctl border border-line">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">The first transactions as Prism reads them</caption>
              <thead className="text-xs text-ink-3">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Date</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Description</th>
                  <th scope="col" className="hidden px-3 py-2 font-semibold sm:table-cell">Category</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {preview.rows.slice(0, 5).map((r, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-2">{shortDate(r.date)}, {r.date.slice(0, 4)}</td>
                    <td className="px-3 py-2 text-ink-1 [overflow-wrap:anywhere]">{r.merchant}</td>
                    <td className="hidden px-3 py-2 text-ink-2 sm:table-cell">{categoryLabel(r.category)}</td>
                    <td className={clsx("num whitespace-nowrap px-3 py-2 text-right font-semibold", r.amount > 0 ? "text-good-ink" : "text-ink-1")}>{money(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-2">No transactions can be read with these columns yet. Choose the date, the description and the amount.</p>
        )}
        {preview.skipped.length ? (
          <details className="mt-2 text-xs text-ink-3">
            <summary className="cursor-pointer font-semibold">Why rows were left out</summary>
            <ul className="mt-1 space-y-0.5">
              {preview.skipped.slice(0, 10).map((s) => (
                <li key={s.line}>
                  Line {s.line}: {s.reason}
                </li>
              ))}
              {preview.skipped.length > 10 ? <li>…and {(preview.skipped.length - 10).toLocaleString("en-US")} more.</li> : null}
            </ul>
          </details>
        ) : null}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className={buttonPrimary} disabled={!usable} onClick={onNext}>
          Next: check the accounts
        </button>
        <button type="button" className={buttonGhost} onClick={onBack}>
          Choose another file
        </button>
      </div>
    </Card>
  );
}

function ChooseAccounts({
  step,
  linked,
  onChange,
  onBack,
  onSave,
}: {
  step: Extract<Step, { kind: "accounts" }>;
  linked: LinkedAccount[];
  onChange: (plans: Plan[]) => void;
  onBack: () => void;
  onSave: (plans: Plan[]) => void;
}) {
  const update = (i: number, patch: Partial<Plan>) => onChange(step.plans.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  const counted = step.plans.map((p) => {
    const rows = step.rows.filter((r) => r.account === p.label);
    const target = p.target === OWN ? null : linked.find((a) => a.id === p.target);
    const kept = target?.since ? rows.filter((r) => r.date < target.since!) : rows;
    const dates = rows.map((r) => r.date).sort();
    return { all: rows.length, kept: kept.length, from: dates[0]!, to: dates.at(-1)!, since: target?.since ?? null };
  });
  const total = counted.reduce((n, c) => n + c.kept, 0);
  const tooMany = step.plans.length > IMPORT_LIMITS.imports;

  return (
    <Card className="p-5 sm:p-6">
      <CardHeader title="Check the accounts" subtitle="Say where each account's history belongs. Older history of an account you've linked joins it; anything else becomes an account of its own, like a card you've closed." />
      <ul className="mt-4 space-y-4">
        {step.plans.map((p, i) => {
          const c = counted[i]!;
          return (
            <li key={p.label} className="rounded-ctl border border-line p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-bold text-ink-1 [overflow-wrap:anywhere]">{p.label}</div>
                <div className="num text-xs text-ink-3">
                  {count(c.all, "transaction", "transactions")} · {monthYear(c.from)} – {monthYear(c.to)}
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <SelectInput
                  name={`target-${i}`}
                  label="Where it belongs"
                  showLabel
                  defaultValue={p.target}
                  onChange={(v) => update(i, { target: v })}
                  options={[{ value: OWN, label: "An account of its own" }, ...linked.map((a) => ({ value: a.id, label: `Older history of ${label(a)}` }))]}
                />
                {p.target === OWN ? (
                  <SelectInput
                    name={`kind-${i}`}
                    label="What kind of account"
                    showLabel
                    defaultValue={p.kind}
                    onChange={(v) => update(i, { kind: v as ImportKind })}
                    options={IMPORT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
                  />
                ) : null}
              </div>
              {p.target === OWN ? (
                <div className="mt-3">
                  <TextInput name={`name-${i}`} label="Its name in Prism" defaultValue={p.name} maxLength={IMPORT_LIMITS.account} hint="Its balance isn't known, so it counts as $0 in your net worth." />
                </div>
              ) : c.since ? (
                <p className="mt-2 text-xs text-ink-2">
                  Only what&apos;s before {shortDate(c.since)}, {c.since.slice(0, 4)} is added — {c.kept.toLocaleString("en-US")} of {c.all.toLocaleString("en-US")}. Your bank&apos;s own copy covers the rest, so nothing counts twice.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {step.skipped.length ? (
        <p className="mt-4 text-xs text-ink-3">
          {count(step.skipped.length, "row", "rows")} in the file couldn&apos;t be read and {step.skipped.length === 1 ? "is" : "are"} left out.
        </p>
      ) : null}
      {tooMany ? (
        <p role="alert" className="mt-4 text-sm font-medium text-crit-ink">
          This file has more than {IMPORT_LIMITS.imports} accounts, the most Prism keeps imports for. Split it and import it in parts.
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonPrimary}
          disabled={total === 0 || tooMany}
          onClick={() => {
            // The names typed in, read once at save (the fields are uncontrolled).
            const names = step.plans.map((p, i) => (document.querySelector<HTMLInputElement>(`input[name="name-${i}"]`)?.value ?? p.name).trim() || p.name);
            onSave(step.plans.map((p, i) => ({ ...p, name: names[i]! })));
          }}
        >
          Import {count(total, "transaction", "transactions")}
        </button>
        <button type="button" className={buttonGhost} onClick={onBack}>
          Start again
        </button>
        {total === 0 ? <StatusPill status="neutral">Nothing new to add</StatusPill> : null}
      </div>
    </Card>
  );
}
