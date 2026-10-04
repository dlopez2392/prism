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
import { Card, CardHeader, StatusPill } from "@/components/ui";
import { money, monthYear, shortDate } from "@/lib/finance/format";
import { combineP2pFiles, matchP2p, P2P_APP_NAMES, P2P_LIMITS, p2pLabel, readP2pFile, type BankLine, type P2pApp, type P2pResult, type P2pRow } from "@/lib/finance/p2p";
import { ledgerHash } from "@/lib/finance/view";
import { removeP2pNotes, saveP2pMatches } from "@/lib/server/p2p-actions";

type Step =
  | { kind: "choose"; error: string | null }
  | { kind: "review"; files: string[]; result: P2pResult; skipped: number }
  | { kind: "saving"; count: number }
  | { kind: "done"; message: string; app: P2pApp }
  | { kind: "failed"; message: string };

const PAGE = 12;
const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

const WHERE: { app: P2pApp; how: string }[] = [
  { app: "venmo", how: "on venmo.com, choose Statements, pick a month and choose Download CSV. One file a month: choose several at once." },
  { app: "paypal", how: "on paypal.com, open Activity, choose Download, and download your activity as CSV." },
  { app: "cashapp", how: "on cash.app, sign in, choose Statements at the top right, then Export CSV." },
];

export function PaymentNotes({ lines, noted }: { lines: BankLine[]; noted: number }) {
  const [step, setStep] = useState<Step>({ kind: "choose", error: null });
  const input = useRef<HTMLInputElement>(null);

  async function choose(list: FileList | null) {
    const files = [...(list ?? [])];
    if (!files.length) return;
    const read: P2pRow[][] = [];
    let skipped = 0;
    for (const f of files) {
      if (f.size > P2P_LIMITS.fileBytes) return setStep({ kind: "choose", error: `${f.name} is over 10 MB, which is more than any of these apps' activity files. Choose the CSV of your activity.` });
      let text: string;
      try {
        text = await f.text();
      } catch {
        return setStep({ kind: "choose", error: `${f.name} couldn't be read. Choose it again.` });
      }
      const parsed = readP2pFile(text);
      if (!parsed) return setStep({ kind: "choose", error: `${f.name} isn't a Venmo, PayPal or Cash App activity file. Download the CSV from the app, then choose it here.` });
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
    if (r.status !== "saved") return setStep({ kind: "failed", message: r.status === "error" ? r.message : "That didn't save. Try again in a moment." });
    const apps = result.matches.map((m) => m.app);
    const app = (["venmo", "paypal", "cashapp"] as const).reduce((a, b) => (apps.filter((x) => x === b).length > apps.filter((x) => x === a).length ? b : a));
    setStep({ kind: "done", message: r.message, app });
  }

  return (
    <div className="space-y-5">
      {step.kind === "choose" ? (
        <Card className="p-5 sm:p-6">
          <CardHeader title="Add your activity files" subtitle="None of these apps lets another app read your account, but each lets you download your own activity. Add one file or several, from any of the three." />
          <ul className="mt-4 space-y-2 text-sm text-ink-2">
            {WHERE.map((w) => (
              <li key={w.app}>
                <span className="font-semibold text-ink-1">{P2P_APP_NAMES[w.app]}:</span> {w.how}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-col items-start gap-3">
            <input ref={input} type="file" multiple accept=".csv,text/csv" className="sr-only" onChange={(e) => choose(e.currentTarget.files)} />
            <button type="button" className={buttonPrimary} onClick={() => input.current?.click()}>
              <FileUp aria-hidden className="size-4" />
              Choose files
            </button>
            <p className="text-xs text-ink-3">The files are read in your browser and never uploaded. Only who each matching payment was for, and its note, are kept, encrypted, in your account.</p>
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
          <CardHeader title="Keeping them" subtitle={`Saving ${count(step.count, "note", "notes")} to your account. Keep this page open.`} />
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
              <h2 className="text-lg font-bold text-ink-1">Done</h2>
              <p className="mt-1 text-sm text-ink-2">{step.message} You&apos;ll see who each was for under the payment on Spending, and you can search by name or note.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href={`/spending?range=12${ledgerHash({ find: P2P_APP_NAMES[step.app].toLowerCase() })}`} className={buttonPrimary}>
                  See them on Spending
                </Link>
                <button type="button" className={buttonGhost} onClick={() => setStep({ kind: "choose", error: null })}>
                  Add more files
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
              <h2 className="text-lg font-bold text-ink-1">Nothing was kept</h2>
              <p className="mt-1 text-sm text-ink-2">{step.message}</p>
              <button type="button" className={clsx(buttonPrimary, "mt-4")} onClick={() => setStep({ kind: "choose", error: null })}>
                Start again
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
  const [shown, setShown] = useState(PAGE);
  const { result } = step;
  const n = result.matches.length;
  const tooMany = n > P2P_LIMITS.notes;
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader
        title={n ? `${count(n, "payment", "payments")} matched to your bank` : "Nothing matched your bank"}
        subtitle={`${step.files.length === 1 ? step.files[0] : count(step.files.length, "file", "files")}${result.from && result.to ? ` · ${monthYear(result.from)} – ${monthYear(result.to)}` : ""}`}
      />
      {n ? (
        <ul className="mt-4 divide-y divide-[var(--line)]">
          {result.matches.slice(0, shown).map((m) => (
            <li key={m.txnId} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink-1">
                  {p2pLabel(m)}
                  {m.note ? <span className="font-normal text-ink-2"> · {m.note}</span> : null}
                </div>
                <div className="truncate text-xs text-ink-3">
                  {P2P_APP_NAMES[m.app]} · on your bank {shortDate(m.bankDate)}
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
          Prism looks for each payment on a Venmo, PayPal or Cash App line in your linked accounts, for the same amount, within a few days. Check the bank or card that pays them is linked, and that the file covers months your bank&apos;s history does.
        </p>
      )}
      {shown < n ? (
        <button type="button" onClick={() => setShown((s) => s + PAGE * 2)} className="mt-3 h-10 w-full rounded-ctl border border-line text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3">
          Show {Math.min(PAGE * 2, n - shown)} more
        </button>
      ) : null}
      <div className="mt-4 space-y-1 text-xs text-ink-3">
        {result.inApp ? <p>{count(result.inApp, "payment stayed", "payments stayed")} in the app&apos;s own balance, so your bank never saw {result.inApp === 1 ? "it" : "them"}. Prism doesn&apos;t count those yet.</p> : null}
        {result.unmatched ? (
          <p>
            {count(result.unmatched, "payment", "payments")} should have reached a bank but no line matched: the account may not be linked, or its history may not go back that far.
          </p>
        ) : null}
        {step.skipped ? <p>{count(step.skipped, "line", "lines")} in {step.files.length === 1 ? "the file" : "the files"} weren&apos;t payments that went through (pending, cancelled, card purchases, other currencies) and are left out.</p> : null}
        {tooMany ? <p>Only the newest {P2P_LIMITS.notes.toLocaleString("en-US")} are kept.</p> : null}
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" className={buttonPrimary} disabled={n === 0} onClick={onKeep}>
          Keep {count(Math.min(n, P2P_LIMITS.notes), "note", "notes")}
        </button>
        <button type="button" className={buttonGhost} onClick={onBack}>
          Choose other files
        </button>
        {n === 0 ? <StatusPill status="neutral">Nothing to keep</StatusPill> : null}
      </div>
    </Card>
  );
}

/** What's kept now, and the way to forget it: nothing else changes, and the files bring it back. */
function Kept({ noted }: { noted: number }) {
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader title={`${count(noted, "payment says", "payments say")} who ${noted === 1 ? "it was" : "they were"} for`} subtitle="Kept, encrypted, in your account. Never shown to your household." />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonGhost}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await removeP2pNotes();
            setBusy(false);
            setSaid(r.status === "saved" ? { ok: true, text: r.message } : { ok: false, text: r.status === "error" ? r.message : "That didn't work." });
          }}
        >
          Remove them all
        </button>
      </div>
      <p role="status" className={clsx("text-sm", said && "mt-3", said?.ok ? "text-good-ink" : "text-crit-ink")}>
        {said?.text ?? null}
      </p>
    </Card>
  );
}
