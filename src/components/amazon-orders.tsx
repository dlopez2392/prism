"use client";

// src/components/amazon-orders.tsx
//
// What each Amazon charge paid for, in three steps: choose the order history
// file, check what matched, keep it. The file is read here, in the browser,
// and never uploaded; only the matches are sent, a batch at a time, and the
// server checks each one again against the person's own Amazon lines
// (src/lib/server/orders-actions.ts).

import { useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileUp, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { buttonGhost, buttonPrimary } from "@/components/dialog";
import { Card, CardHeader, StatusPill } from "@/components/ui";
import { money, monthYear, shortDate } from "@/lib/finance/format";
import { matchOrders, ORDER_LIMITS, orderLabel, readAmazonFile, type BankLine, type OrderResult } from "@/lib/finance/orders";
import { ledgerHash } from "@/lib/finance/view";
import { removeOrderNotes, saveOrderMatches } from "@/lib/server/orders-actions";

type Step =
  | { kind: "choose"; error: string | null }
  | { kind: "review"; file: string; result: OrderResult; skipped: number }
  | { kind: "saving"; done: number; total: number }
  | { kind: "done"; saved: number; dropped: number }
  | { kind: "failed"; message: string; saved: number };

const PAGE = 12;
const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function AmazonOrders({ lines, noted }: { lines: BankLine[]; noted: number }) {
  const [step, setStep] = useState<Step>({ kind: "choose", error: null });
  const input = useRef<HTMLInputElement>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    if (/\.zip$/i.test(file.name)) return setStep({ kind: "choose", error: "That's the zip Amazon sends. Open it, then choose Retail.OrderHistory.1.csv from inside the Retail.OrderHistory.1 folder." });
    if (file.size > ORDER_LIMITS.fileBytes) return setStep({ kind: "choose", error: `${file.name} is over 40 MB, which is more than any order history. Choose Retail.OrderHistory.1.csv.` });
    let text: string;
    try {
      text = await file.text();
    } catch {
      return setStep({ kind: "choose", error: `${file.name} couldn't be read. Choose it again.` });
    }
    const parsed = readAmazonFile(text);
    if (!parsed) return setStep({ kind: "choose", error: `${file.name} isn't Amazon's order history. Choose Retail.OrderHistory.1.csv from the zip Amazon sends.` });
    setStep({ kind: "review", file: file.name, result: matchOrders(parsed.rows, lines), skipped: parsed.skipped });
  }

  async function keep(result: OrderResult) {
    // Newest first, as many as are kept, a batch at a time so no request grows too big to send.
    const matches = result.matches.slice(0, ORDER_LIMITS.notes).map(({ txnId, order, date, items }) => ({ txnId, order, date, items }));
    let saved = 0;
    let dropped = 0;
    for (let at = 0; at < matches.length; at += ORDER_LIMITS.batch) {
      setStep({ kind: "saving", done: at, total: matches.length });
      const r = await saveOrderMatches(matches.slice(at, at + ORDER_LIMITS.batch));
      if (r.status !== "saved") return setStep({ kind: "failed", message: r.status === "error" ? r.message : "That didn't save. Try again in a moment.", saved });
      saved += r.saved;
      dropped += r.dropped;
    }
    if (saved === 0) return setStep({ kind: "failed", message: "None of those charges match a line in your accounts any more. Check the card you pay Amazon with is linked.", saved });
    setStep({ kind: "done", saved, dropped });
  }

  return (
    <div className="space-y-5">
      {step.kind === "choose" ? (
        <Card className="p-5 sm:p-6">
          <CardHeader title="Add your Amazon order history" subtitle="Amazon doesn't let other apps read your orders, but it sends you your own history when you ask." />
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-ink-2">
            <li>
              On amazon.com, open <span className="font-semibold text-ink-1">Account</span>, then <span className="font-semibold text-ink-1">Request your data</span>, choose{" "}
              <span className="font-semibold text-ink-1">Your Orders</span>, and submit the request.
            </li>
            <li>Amazon emails a download link, usually within a day or two. Download the zip and open it.</li>
            <li>
              Choose <span className="font-semibold text-ink-1">Retail.OrderHistory.1.csv</span>, inside its <span className="font-semibold text-ink-1">Retail.OrderHistory.1</span> folder.
            </li>
          </ol>
          <div className="mt-5 flex flex-col items-start gap-3">
            <input ref={input} type="file" accept=".csv,text/csv,.zip" className="sr-only" onChange={(e) => choose(e.currentTarget.files?.[0])} />
            <button type="button" className={buttonPrimary} onClick={() => input.current?.click()}>
              <FileUp aria-hidden className="size-4" />
              Choose the file
            </button>
            <p className="text-xs text-ink-3">The file is read in your browser and never uploaded. Only what each matching charge paid for is kept, encrypted, in your account. Your addresses in the file are never read.</p>
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
          <CardHeader title="Keeping them" subtitle={`Saved ${step.done.toLocaleString("en-US")} of ${count(step.total, "charge", "charges")} to your account. Keep this page open.`} />
          <div className="mt-4 h-2 overflow-hidden rounded-pill bg-surface-2">
            <div className="h-full rounded-pill bg-button transition-[width] duration-250" style={{ width: `${Math.max(4, (step.done / step.total) * 100)}%` }} />
          </div>
        </Card>
      ) : null}

      {step.kind === "done" ? (
        <Card className="p-5 sm:p-6">
          <div role="status" className="flex items-start gap-3">
            <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-good" />
            <div>
              <h2 className="text-lg font-bold text-ink-1">Done</h2>
              <p className="mt-1 text-sm text-ink-2">
                {count(step.saved, "Amazon charge now says", "Amazon charges now say")} what {step.saved === 1 ? "it" : "they"} paid for.
                {step.dropped ? ` ${count(step.dropped, "charge", "charges")} no longer matched your accounts, so ${step.dropped === 1 ? "it was" : "they were"} left out.` : ""} You&apos;ll see the items under each charge on
                Spending, search them by name, and split a charge by its items.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href={`/spending?range=12${ledgerHash({ find: "amazon" })}`} className={buttonPrimary}>
                  See them on Spending
                </Link>
                <button type="button" className={buttonGhost} onClick={() => setStep({ kind: "choose", error: null })}>
                  Add a newer file
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
              <h2 className="text-lg font-bold text-ink-1">{step.saved ? `${count(step.saved, "charge was", "charges were")} kept before it stopped` : "Nothing was kept"}</h2>
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
  const tooMany = n > ORDER_LIMITS.notes;
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader
        title={n ? `${count(n, "Amazon charge", "Amazon charges")} matched to your bank` : "Nothing matched your bank"}
        subtitle={`${step.file}${result.from && result.to ? ` · ${monthYear(result.from)} – ${monthYear(result.to)}` : ""} · ${count(result.orders, "order", "orders")}`}
      />
      {n ? (
        <ul className="mt-4 divide-y divide-[var(--line)]">
          {result.matches.slice(0, shown).map((m) => (
            <li key={m.txnId} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink-1">{orderLabel(m)}</div>
                <div className="truncate text-xs text-ink-3">
                  {count(m.items.length, "item", "items")} · on your bank {shortDate(m.bankDate)}
                </div>
              </div>
              <div className="num shrink-0 text-sm font-bold text-ink-1">{money(m.amount)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-2">
          Prism looks for each shipment on an Amazon line in your linked accounts, for exactly what it cost, within a few days of shipping. Check the card you pay Amazon with is linked, and that the file covers months your bank&apos;s history does.
        </p>
      )}
      {shown < n ? (
        <button type="button" onClick={() => setShown((s) => s + PAGE * 2)} className="mt-3 h-10 w-full rounded-ctl border border-line text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3">
          Show {Math.min(PAGE * 2, n - shown)} more
        </button>
      ) : null}
      <div className="mt-4 space-y-1 text-xs text-ink-3">
        {result.unmatched ? (
          <p>
            {count(result.unmatched, "order", "orders")} matched no line: paid with a gift card or points, charged to a card that isn&apos;t linked, from before your bank&apos;s history, or refunded.
          </p>
        ) : null}
        {step.skipped ? <p>{count(step.skipped, "item", "items")} in the file {step.skipped === 1 ? "was" : "were"} cancelled, free, or in another currency, and {step.skipped === 1 ? "is" : "are"} left out.</p> : null}
        {tooMany ? <p>Only the newest {ORDER_LIMITS.notes.toLocaleString("en-US")} are kept.</p> : null}
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" className={buttonPrimary} disabled={n === 0} onClick={onKeep}>
          Keep {count(Math.min(n, ORDER_LIMITS.notes), "charge", "charges")}
        </button>
        <button type="button" className={buttonGhost} onClick={onBack}>
          Choose another file
        </button>
        {n === 0 ? <StatusPill status="neutral">Nothing to keep</StatusPill> : null}
      </div>
    </Card>
  );
}

/** What's kept now, and the way to forget it: nothing else changes, and the file brings it back. */
function Kept({ noted }: { noted: number }) {
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader title={`${count(noted, "Amazon charge says", "Amazon charges say")} what ${noted === 1 ? "it" : "they"} paid for`} subtitle="Kept, encrypted, in your account. Never shown to your household." />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonGhost}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await removeOrderNotes();
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
