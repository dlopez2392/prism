"use client";

// src/components/payment-notes.tsx
//
// Who each Venmo, PayPal or Cash App payment was for, in three steps: choose
// the apps' activity files, check what matched, keep it. The files are read
// here, in the browser, and never uploaded; only the matches are sent, and
// the server checks each one again against the person's own bank lines
// (src/lib/server/p2p-actions.ts).

import { useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileUp, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { buttonGhost, buttonPrimary } from "@/components/dialog";
import { useT } from "@/components/locale";
import { Card, CardHeader, StatusPill } from "@/components/ui";
import { money, monthYear, shortDate } from "@/lib/finance/format";
import { combineP2pFiles, matchP2p, P2P_APP_NAMES, P2P_LIMITS, p2pLabel, readP2pFile, type BankLine, type P2pApp, type P2pResult, type P2pRow } from "@/lib/finance/p2p";
import { ledgerHash } from "@/lib/finance/view";
import { msg } from "@/lib/i18n/t";
import { removeP2pNotes, saveP2pMatches } from "@/lib/server/p2p-actions";

type Step =
  | { kind: "choose"; error: string | null }
  | { kind: "review"; files: string[]; result: P2pResult; skipped: number }
  | { kind: "saving"; count: number }
  | { kind: "done"; message: string; app: P2pApp }
  | { kind: "failed"; message: string };

const PAGE = 12;
/** 2,450: counts are written the U.S. way in both languages, as amounts are. */
const num = (n: number) => n.toLocaleString("en-US");

/** Where each app keeps its file. The menu names are the app's own, which may be in English whatever the page's language. */
const WHERE: { app: P2pApp; how: string }[] = [
  { app: "venmo", how: msg("on venmo.com, choose Statements, pick a month and choose Download CSV. One file a month: choose several at once.") },
  { app: "paypal", how: msg("on paypal.com, open Activity, choose Download, and download your activity as CSV.") },
  { app: "cashapp", how: msg("on cash.app, sign in, choose Statements at the top right, then Export CSV.") },
];

export function PaymentNotes({ lines, noted }: { lines: BankLine[]; noted: number }) {
  const t = useT();
  const [step, setStep] = useState<Step>({ kind: "choose", error: null });
  const input = useRef<HTMLInputElement>(null);

  async function choose(list: FileList | null) {
    const files = [...(list ?? [])];
    if (!files.length) return;
    const read: P2pRow[][] = [];
    let skipped = 0;
    for (const f of files) {
      if (f.size > P2P_LIMITS.fileBytes) return setStep({ kind: "choose", error: t("{file} is over 10 MB, which is more than any of these apps' activity files. Choose the CSV of your activity.", { file: f.name }) });
      let text: string;
      try {
        text = await f.text();
      } catch {
        return setStep({ kind: "choose", error: t("{file} couldn't be read. Choose it again.", { file: f.name }) });
      }
      const parsed = readP2pFile(text);
      if (!parsed) return setStep({ kind: "choose", error: t("{file} isn't a Venmo, PayPal or Cash App activity file. Download the CSV from the app, then choose it here.", { file: f.name }) });
      read.push(parsed.rows);
      skipped += parsed.skipped;
    }
    setStep({ kind: "review", files: files.map((f) => f.name), result: matchP2p(combineP2pFiles(read), lines), skipped });
  }

  async function keep(result: P2pResult) {
    // Newest first, as many as one save keeps.
    const matches = result.matches.slice(0, P2P_LIMITS.notes).map(({ txnId, app, dir, name, note, date }) => ({ txnId, app, dir, name, note, date }));
    setStep({ kind: "saving", count: matches.length });
    const r = await saveP2pMatches(matches);
    if (r.status !== "saved") return setStep({ kind: "failed", message: r.status === "error" ? r.message : t("That didn't save. Try again in a moment.") });
    const apps = result.matches.map((m) => m.app);
    const app = (["venmo", "paypal", "cashapp"] as const).reduce((a, b) => (apps.filter((x) => x === b).length > apps.filter((x) => x === a).length ? b : a));
    setStep({ kind: "done", message: r.message, app });
  }

  return (
    <div className="space-y-5">
      {step.kind === "choose" ? (
        <Card className="p-5 sm:p-6">
          <CardHeader
            title={t("Add your activity files")}
            subtitle={t("None of these apps lets another app read your account, but each lets you download your own activity. Add one file or several, from any of the three.")}
          />
          <ul className="mt-4 space-y-2 text-sm text-ink-2">
            {WHERE.map((w) => (
              <li key={w.app}>
                <span className="font-semibold text-ink-1">{P2P_APP_NAMES[w.app]}:</span> {t(w.how)}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-col items-start gap-3">
            <input ref={input} type="file" multiple accept=".csv,text/csv" className="sr-only" onChange={(e) => choose(e.currentTarget.files)} />
            <button type="button" className={buttonPrimary} onClick={() => input.current?.click()}>
              <FileUp aria-hidden className="size-4" />
              {t("Choose files")}
            </button>
            <p className="text-xs text-ink-3">{t("The files are read in your browser and never uploaded. Only who each matching payment was for, and its note, are kept, encrypted, in your account.")}</p>
            {step.error ? (
              <p role="alert" className="text-sm font-medium text-crit-ink">
                {step.error}
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {step.kind === "review" ? <Review step={step} onBack={() => setStep({ kind: "choose", error: null })} onKeep={() => keep(step.result)} /> : null}

      {step.kind === "saving" ? (
        <Card className="p-5 sm:p-6" aria-busy="true">
          <CardHeader
            title={t("Keeping them")}
            subtitle={step.count === 1 ? t("Saving 1 note to your account. Keep this page open.") : t("Saving {n} notes to your account. Keep this page open.", { n: num(step.count) })}
          />
          <div className="mt-4 h-2 overflow-hidden rounded-pill bg-surface-2">
            <div className="skeleton h-full w-full" />
          </div>
        </Card>
      ) : null}

      {step.kind === "done" ? (
        <Card className="p-5 sm:p-6">
          <div role="status" className="flex items-start gap-3">
            <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-good" />
            <div>
              <h2 className="text-lg font-bold text-ink-1">{t("Done")}</h2>
              <p className="mt-1 text-sm text-ink-2">
                {step.message} {t("You'll see who each was for under the payment on Spending, and you can search by name or note.")}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href={`/spending?range=12${ledgerHash({ find: P2P_APP_NAMES[step.app].toLowerCase() })}`} className={buttonPrimary}>
                  {t("See them on Spending")}
                </Link>
                <button type="button" className={buttonGhost} onClick={() => setStep({ kind: "choose", error: null })}>
                  {t("Add more files")}
                </button>
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
              <h2 className="text-lg font-bold text-ink-1">{t("Nothing was kept")}</h2>
              <p className="mt-1 text-sm text-ink-2">{step.message}</p>
              <button type="button" className={clsx(buttonPrimary, "mt-4")} onClick={() => setStep({ kind: "choose", error: null })}>
                {t("Start again")}
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      {noted > 0 && step.kind !== "saving" ? <Kept noted={noted} /> : null}
    </div>
  );
}

function Review({ step, onBack, onKeep }: { step: Extract<Step, { kind: "review" }>; onBack: () => void; onKeep: () => void }) {
  const t = useT();
  const [shown, setShown] = useState(PAGE);
  const { result } = step;
  const n = result.matches.length;
  const tooMany = n > P2P_LIMITS.notes;
  const kept = Math.min(n, P2P_LIMITS.notes);
  const oneFile = step.files.length === 1;
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader
        title={n === 0 ? t("Nothing matched your bank") : n === 1 ? t("1 payment matched to your bank") : t("{n} payments matched to your bank", { n: num(n) })}
        subtitle={`${oneFile ? step.files[0] : t("{n} files", { n: num(step.files.length) })}${result.from && result.to ? ` · ${monthYear(result.from, t.locale)} – ${monthYear(result.to, t.locale)}` : ""}`}
      />
      {n ? (
        <ul className="mt-4 divide-y divide-[var(--line)]">
          {result.matches.slice(0, shown).map((m) => (
            <li key={m.txnId} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink-1">
                  {p2pLabel(m, t)}
                  {m.note ? <span className="font-normal text-ink-2"> · {m.note}</span> : null}
                </div>
                <div className="truncate text-xs text-ink-3">
                  {P2P_APP_NAMES[m.app]} · {t("on your bank {date}", { date: shortDate(m.bankDate, t.locale) })}
                </div>
              </div>
              <div className={clsx("num shrink-0 text-sm font-bold", m.amount > 0 ? "text-good-ink" : "text-ink-1")}>
                {m.amount > 0 ? "+" : ""}
                {money(m.amount)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-2">
          {t(
            "Prism looks for each payment on a Venmo, PayPal or Cash App line in your linked accounts, for the same amount, within a few days. Check the bank or card that pays them is linked, and that the file covers months your bank's history does.",
          )}
        </p>
      )}
      {shown < n ? (
        <button type="button" onClick={() => setShown((s) => s + PAGE * 2)} className="mt-3 h-10 w-full rounded-ctl border border-line text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3">
          {t("Show {n} more", { n: Math.min(PAGE * 2, n - shown) })}
        </button>
      ) : null}
      <div className="mt-4 space-y-1 text-xs text-ink-3">
        {result.inApp ? (
          <p>
            {result.inApp === 1
              ? t("1 payment stayed in the app's own balance, so your bank never saw it. Prism doesn't count those yet.")
              : t("{n} payments stayed in the app's own balance, so your bank never saw them. Prism doesn't count those yet.", { n: num(result.inApp) })}
          </p>
        ) : null}
        {result.unmatched ? (
          <p>
            {result.unmatched === 1
              ? t("1 payment should have reached a bank but no line matched: the account may not be linked, or its history may not go back that far.")
              : t("{n} payments should have reached a bank but no line matched: the account may not be linked, or its history may not go back that far.", { n: num(result.unmatched) })}
          </p>
        ) : null}
        {step.skipped ? (
          <p>
            {step.skipped === 1
              ? oneFile
                ? t("1 line in the file wasn't a payment that went through (pending, cancelled, card purchases, other currencies) and is left out.")
                : t("1 line in the files wasn't a payment that went through (pending, cancelled, card purchases, other currencies) and is left out.")
              : oneFile
                ? t("{n} lines in the file weren't payments that went through (pending, cancelled, card purchases, other currencies) and are left out.", { n: num(step.skipped) })
                : t("{n} lines in the files weren't payments that went through (pending, cancelled, card purchases, other currencies) and are left out.", { n: num(step.skipped) })}
          </p>
        ) : null}
        {tooMany ? <p>{t("Only the newest {n} are kept.", { n: num(P2P_LIMITS.notes) })}</p> : null}
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" className={buttonPrimary} disabled={n === 0} onClick={onKeep}>
          {kept === 1 ? t("Keep 1 note") : t("Keep {n} notes", { n: num(kept) })}
        </button>
        <button type="button" className={buttonGhost} onClick={onBack}>
          {t("Choose other files")}
        </button>
        {n === 0 ? <StatusPill status="neutral">{t("Nothing to keep")}</StatusPill> : null}
      </div>
    </Card>
  );
}

/** What's kept now, and the way to forget it: nothing else changes, and the files bring it back. */
function Kept({ noted }: { noted: number }) {
  const t = useT();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader
        title={noted === 1 ? t("1 payment says who it was for") : t("{n} payments say who they were for", { n: num(noted) })}
        subtitle={t("Kept, encrypted, in your account. Never shown to your household.")}
      />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonGhost}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await removeP2pNotes();
            setBusy(false);
            setSaid(r.status === "saved" ? { ok: true, text: r.message } : { ok: false, text: r.status === "error" ? r.message : t("That didn't work.") });
          }}
        >
          {t("Remove them all")}
        </button>
      </div>
      <p role="status" className={clsx("text-sm", said && "mt-3", said?.ok ? "text-good-ink" : "text-crit-ink")}>
        {said?.text ?? null}
      </p>
    </Card>
  );
}
