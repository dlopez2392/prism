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
import { useT } from "@/components/locale";
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
/** 2,450: counts are written the U.S. way in both languages, as amounts are. */
const num = (n: number) => n.toLocaleString("en-US");
/** Amazon's own file and folder names, which stay as Amazon writes them in any language. */
const FILE = "Retail.OrderHistory.1.csv";
const FOLDER = "Retail.OrderHistory.1";

/**
 * A translated sentence with Amazon's own words in bold: each {name} in it is one of `words`, as Amazon
 * writes it (its menus may be in English whatever the page's language).
 */
function AmazonWords({ text, words }: { text: string; words: Record<string, string> }) {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return name && Object.hasOwn(words, name) ? (
      <span key={i} className="font-semibold text-ink-1">
        {words[name]}
      </span>
    ) : (
      part
    );
  });
}

export function AmazonOrders({ lines, noted }: { lines: BankLine[]; noted: number }) {
  const t = useT();
  const [step, setStep] = useState<Step>({ kind: "choose", error: null });
  const input = useRef<HTMLInputElement>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    if (/\.zip$/i.test(file.name)) return setStep({ kind: "choose", error: t("That's the zip Amazon sends. Open it, then choose {file} from inside the {folder} folder.", { file: FILE, folder: FOLDER }) });
    if (file.size > ORDER_LIMITS.fileBytes) return setStep({ kind: "choose", error: t("{name} is over 40 MB, which is more than any order history. Choose {file}.", { name: file.name, file: FILE }) });
    let text: string;
    try {
      text = await file.text();
    } catch {
      return setStep({ kind: "choose", error: t("{file} couldn't be read. Choose it again.", { file: file.name }) });
    }
    const parsed = readAmazonFile(text, t);
    if (!parsed) return setStep({ kind: "choose", error: t("{name} isn't Amazon's order history. Choose {file} from the zip Amazon sends.", { name: file.name, file: FILE }) });
    setStep({ kind: "review", file: file.name, result: matchOrders(parsed.rows, lines, t), skipped: parsed.skipped });
  }

  async function keep(result: OrderResult) {
    // Newest first, as many as are kept, a batch at a time so no request grows too big to send.
    const matches = result.matches.slice(0, ORDER_LIMITS.notes).map(({ txnId, order, date, items }) => ({ txnId, order, date, items }));
    let saved = 0;
    let dropped = 0;
    for (let at = 0; at < matches.length; at += ORDER_LIMITS.batch) {
      setStep({ kind: "saving", done: at, total: matches.length });
      const r = await saveOrderMatches(matches.slice(at, at + ORDER_LIMITS.batch));
      if (r.status !== "saved") return setStep({ kind: "failed", message: r.status === "error" ? r.message : t("That didn't save. Try again in a moment."), saved });
      saved += r.saved;
      dropped += r.dropped;
    }
    if (saved === 0) return setStep({ kind: "failed", message: t("None of those charges match a line in your accounts any more. Check the card you pay Amazon with is linked."), saved });
    setStep({ kind: "done", saved, dropped });
  }

  return (
    <div className="space-y-5">
      {step.kind === "choose" ? (
        <Card className="p-5 sm:p-6">
          <CardHeader title={t("Add your Amazon order history")} subtitle={t("Amazon doesn't let other apps read your orders, but it sends you your own history when you ask.")} />
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-ink-2">
            <li>
              <AmazonWords
                text={t("On amazon.com, open {account}, then {request}, choose {orders}, and submit the request.")}
                words={{ account: "Account", request: "Request your data", orders: "Your Orders" }}
              />
            </li>
            <li>{t("Amazon emails a download link, usually within a day or two. Download the zip and open it.")}</li>
            <li>
              <AmazonWords text={t("Choose {file}, inside its {folder} folder.")} words={{ file: FILE, folder: FOLDER }} />
            </li>
          </ol>
          <div className="mt-5 flex flex-col items-start gap-3">
            <input ref={input} type="file" accept=".csv,text/csv,.zip" className="sr-only" onChange={(e) => choose(e.currentTarget.files?.[0])} />
            <button type="button" className={buttonPrimary} onClick={() => input.current?.click()}>
              <FileUp aria-hidden className="size-4" />
              {t("Choose the file")}
            </button>
            <p className="text-xs text-ink-3">
              {t("The file is read in your browser and never uploaded. Only what each matching charge paid for is kept, encrypted, in your account. Your addresses in the file are never read.")}
            </p>
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
            subtitle={
              step.total === 1
                ? t("Saved {done} of 1 charge to your account. Keep this page open.", { done: num(step.done) })
                : t("Saved {done} of {n} charges to your account. Keep this page open.", { done: num(step.done), n: num(step.total) })
            }
          />
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
              <h2 className="text-lg font-bold text-ink-1">{t("Done")}</h2>
              <p className="mt-1 text-sm text-ink-2">
                {[
                  step.saved === 1 ? t("1 Amazon charge now says what it paid for.") : t("{n} Amazon charges now say what they paid for.", { n: num(step.saved) }),
                  step.dropped === 0
                    ? null
                    : step.dropped === 1
                      ? t("1 charge no longer matched your accounts, so it was left out.")
                      : t("{n} charges no longer matched your accounts, so they were left out.", { n: num(step.dropped) }),
                  t("You'll see the items under each charge on Spending, search them by name, and split a charge by its items."),
                ]
                  .filter(Boolean)
                  .join(" ")}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href={`/spending?range=12${ledgerHash({ find: "amazon" })}`} className={buttonPrimary}>
                  {t("See them on Spending")}
                </Link>
                <button type="button" className={buttonGhost} onClick={() => setStep({ kind: "choose", error: null })}>
                  {t("Add a newer file")}
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
              <h2 className="text-lg font-bold text-ink-1">
                {step.saved === 0
                  ? t("Nothing was kept")
                  : step.saved === 1
                    ? t("1 charge was kept before it stopped")
                    : t("{n} charges were kept before it stopped", { n: num(step.saved) })}
              </h2>
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
  const tooMany = n > ORDER_LIMITS.notes;
  const kept = Math.min(n, ORDER_LIMITS.notes);
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader
        title={n === 0 ? t("Nothing matched your bank") : n === 1 ? t("1 Amazon charge matched to your bank") : t("{n} Amazon charges matched to your bank", { n: num(n) })}
        subtitle={`${step.file}${result.from && result.to ? ` · ${monthYear(result.from, t.locale)} – ${monthYear(result.to, t.locale)}` : ""} · ${result.orders === 1 ? t("1 order") : t("{n} orders", { n: num(result.orders) })}`}
      />
      {n ? (
        <ul className="mt-4 divide-y divide-[var(--line)]">
          {result.matches.slice(0, shown).map((m) => (
            <li key={m.txnId} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink-1">{orderLabel(m, t)}</div>
                <div className="truncate text-xs text-ink-3">
                  {m.items.length === 1 ? t("1 item") : t("{n} items", { n: num(m.items.length) })} · {t("on your bank {date}", { date: shortDate(m.bankDate, t.locale) })}
                </div>
              </div>
              <div className="num shrink-0 text-sm font-bold text-ink-1">{money(m.amount)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-2">
          {t(
            "Prism looks for each shipment on an Amazon line in your linked accounts, for exactly what it cost, within a few days of shipping. Check the card you pay Amazon with is linked, and that the file covers months your bank's history does.",
          )}
        </p>
      )}
      {shown < n ? (
        <button type="button" onClick={() => setShown((s) => s + PAGE * 2)} className="mt-3 h-10 w-full rounded-ctl border border-line text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3">
          {t("Show {n} more", { n: Math.min(PAGE * 2, n - shown) })}
        </button>
      ) : null}
      <div className="mt-4 space-y-1 text-xs text-ink-3">
        {result.unmatched ? (
          <p>
            {result.unmatched === 1
              ? t("1 order matched no line: paid with a gift card or points, charged to a card that isn't linked, from before your bank's history, or refunded.")
              : t("{n} orders matched no line: paid with a gift card or points, charged to a card that isn't linked, from before your bank's history, or refunded.", { n: num(result.unmatched) })}
          </p>
        ) : null}
        {step.skipped ? (
          <p>
            {step.skipped === 1
              ? t("1 item in the file was cancelled, free, or in another currency, and is left out.")
              : t("{n} items in the file were cancelled, free, or in another currency, and are left out.", { n: num(step.skipped) })}
          </p>
        ) : null}
        {tooMany ? <p>{t("Only the newest {n} are kept.", { n: num(ORDER_LIMITS.notes) })}</p> : null}
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" className={buttonPrimary} disabled={n === 0} onClick={onKeep}>
          {kept === 1 ? t("Keep 1 charge") : t("Keep {n} charges", { n: num(kept) })}
        </button>
        <button type="button" className={buttonGhost} onClick={onBack}>
          {t("Choose another file")}
        </button>
        {n === 0 ? <StatusPill status="neutral">{t("Nothing to keep")}</StatusPill> : null}
      </div>
    </Card>
  );
}

/** What's kept now, and the way to forget it: nothing else changes, and the file brings it back. */
function Kept({ noted }: { noted: number }) {
  const t = useT();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader
        title={noted === 1 ? t("1 Amazon charge says what it paid for") : t("{n} Amazon charges say what they paid for", { n: num(noted) })}
        subtitle={t("Kept, encrypted, in your account. Never shown to your household.")}
      />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonGhost}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await removeOrderNotes();
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
