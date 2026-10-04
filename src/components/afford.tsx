"use client";

// src/components/afford.tsx
//
// "Can I afford it?" on Future: say what it is and how much, and the answer
// appears as you type. Nothing is saved or sent anywhere: the arithmetic runs
// in the browser over the forecast the page already drew (finance/afford.ts),
// so trying a car payment leaves no trace.

import { useId, useState } from "react";
import clsx from "clsx";
import { StatusPill, type Status } from "@/components/ui";
import { AFFORD_HORIZON_DAYS, AFFORD_MAX, tryScenario, validScenario, type AffordBase, type ScenarioKind, type Verdict } from "@/lib/finance/afford";
import { addDays } from "@/lib/finance/dates";
import { money0, shortDate } from "@/lib/finance/format";
import { parseDollars } from "@/lib/finance/plan";

const KINDS: { kind: ScenarioKind; label: string; amount: string; date: string }[] = [
  { kind: "once", label: "Something to buy", amount: "How much?", date: "When?" },
  { kind: "monthly", label: "A new monthly bill", amount: "How much a month?", date: "Starting" },
  { kind: "raise", label: "A raise", amount: "How much more a month?", date: "Starting" },
];

const ANSWER: Record<Verdict["answer"], { status: Status; word: string }> = {
  yes: { status: "good", word: "Fits" },
  tight: { status: "warn", word: "Tight" },
  no: { status: "crit", word: "Doesn't fit" },
};

const field = "h-10 w-full rounded-ctl border border-line-strong bg-surface-2 text-sm text-ink-1 placeholder:text-ink-3 focus:border-[var(--focus)] aria-[invalid=true]:border-crit";

export function CanIAfford({ base }: { base: AffordBase }) {
  const id = useId();
  const [kind, setKind] = useState<ScenarioKind>("once");
  const [amountText, setAmountText] = useState("");
  const [date, setDate] = useState(base.today);
  const k = KINDS.find((x) => x.kind === kind)!;
  const typed = amountText.trim() !== "";
  const amount = typed ? parseDollars(amountText) : null;
  const last = addDays(base.today, AFFORD_HORIZON_DAYS);
  const amountError = !typed ? null : amount === null || amount === 0 ? "Type an amount in dollars, like 1,200 or 49.99." : amount > AFFORD_MAX ? "That's more than Prism can test from a checking account." : null;
  const dateError = date < base.today || date > last ? "Pick a day from today to a year from now." : null;
  const scenario = amount && !amountError && !dateError ? validScenario({ kind, amount, date }, base.today) : null;
  const verdict = scenario ? tryScenario(base, scenario) : null;
  const kept = (c: number | null) => (c === null ? "—" : `${money0(c)}/mo`);

  return (
    <div>
      <div role="group" aria-label="What it is" className="flex flex-wrap gap-2">
        {KINDS.map((x) => (
          <button
            key={x.kind}
            type="button"
            aria-pressed={x.kind === kind}
            onClick={() => setKind(x.kind)}
            className={clsx(
              "inline-flex h-9 items-center rounded-pill border px-3 text-sm font-semibold transition-colors duration-150",
              x.kind === kind ? "border-transparent bg-button text-ink-on-accent" : "border-line text-ink-2 hover:bg-surface-3",
            )}
          >
            {x.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-amount`} className="mb-1 block text-[13px] font-semibold text-ink-2">
            {k.amount}
          </label>
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-sm text-ink-3">
              $
            </span>
            <input
              id={`${id}-amount`}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder={kind === "once" ? "1,200" : "350"}
              aria-invalid={amountError ? true : undefined}
              aria-describedby={amountError ? `${id}-amount-note` : undefined}
              className={clsx(field, "num pr-3 pl-7")}
            />
          </div>
          {amountError ? (
            <p id={`${id}-amount-note`} className="mt-1 text-xs font-medium text-crit-ink">
              {amountError}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor={`${id}-date`} className="mb-1 block text-[13px] font-semibold text-ink-2">
            {k.date}
          </label>
          <input
            id={`${id}-date`}
            type="date"
            value={date}
            min={base.today}
            max={last}
            onChange={(e) => setDate(e.target.value || base.today)}
            aria-invalid={dateError ? true : undefined}
            aria-describedby={dateError ? `${id}-date-note` : undefined}
            className={clsx(field, "num px-3")}
          />
          {dateError ? (
            <p id={`${id}-date-note`} className="mt-1 text-xs font-medium text-crit-ink">
              {dateError}
            </p>
          ) : null}
        </div>
      </div>

      <div aria-live="polite" className="mt-4">
        {verdict ? (
          <div className="rounded-ctl bg-surface-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={ANSWER[verdict.answer].status} className="bg-surface-1">
                {ANSWER[verdict.answer].word}
              </StatusPill>
              <span className="text-[15px] font-bold text-ink-1">{verdict.headline}</span>
            </div>
            <ul className="mt-2 space-y-1 text-sm text-ink-2">
              {verdict.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <dl className="mt-3 grid gap-3 sm:grid-cols-3">
              <Change label="Lowest point ahead" before={money0(verdict.lowestBefore.balance)} after={money0(verdict.lowest.balance)} note={verdict.lowest.date === base.today ? "today" : `around ${shortDate(verdict.lowest.date)}`} />
              <Change label="Safe to spend today" before={money0(verdict.safeBefore)} after={money0(verdict.safeAfter)} />
              <Change label="You usually keep" before={kept(verdict.keptBefore)} after={kept(verdict.keptAfter)} note={verdict.keptBefore === null ? "needs three full months" : "last three full months"} />
            </dl>
          </div>
        ) : (
          <p className="text-sm text-ink-3">Type an amount to see whether it fits. Nothing you try here is saved.</p>
        )}
      </div>
    </div>
  );
}

function Change({ label, before, after, note }: { label: string; before: string; after: string; note?: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-1">
        {before === after ? null : (
          <>
            <span aria-hidden className="num text-ink-3 line-through decoration-1">
              {before}
            </span>
            <span aria-hidden> → </span>
            <span className="sr-only">{`from ${before} to `}</span>
          </>
        )}
        <span className="num font-bold">{after}</span>
        {note ? <span className="block text-xs text-ink-3">{note}</span> : null}
      </dd>
    </div>
  );
}
