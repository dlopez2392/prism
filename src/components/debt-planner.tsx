"use client";

// src/components/debt-planner.tsx
//
// "Paying off what you owe" on Net worth: tick the debts, check each one's
// rate and monthly payment (the lender's, when Prism reads them), add an
// extra, and see both orders side by side: highest rate first and smallest
// balance first, against paying only what each asks. Nothing is saved or
// sent: the arithmetic runs in the browser (finance/payoff.ts). It says what
// each order would do, never which to pick.

import { useId, useState } from "react";
import clsx from "clsx";
import { ChartCard } from "@/components/chart-card";
import { useT } from "@/components/locale";
import { Legend } from "@/components/charts/core";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { StatusPill } from "@/components/ui";
import { addMonths, startOfMonth } from "@/lib/finance/dates";
import { capitalized, money0, monthShort, monthYear } from "@/lib/finance/format";
import { comparePayoff, PAYOFF_LIMITS, parseRate, type Debt, type DebtAccount, type PayoffOrder, type PayoffPlan } from "@/lib/finance/payoff";
import { dollarsInput, parseDollars } from "@/lib/finance/plan";
import type { Cents, ISODate } from "@/lib/finance/types";
import { msg, type T } from "@/lib/i18n/t";

/** Each order's name in English: shown with t(). */
const ORDERS: { order: PayoffOrder; label: string }[] = [
  { order: "avalanche", label: msg("Highest rate first") },
  { order: "snowball", label: msg("Smallest balance first") },
];

/** The chart shows at most thirty years: past that the line is flat news. */
const CHART_MONTHS = 360;

const field = "h-10 w-full rounded-ctl border border-line-strong bg-surface-2 text-sm text-ink-1 placeholder:text-ink-3 focus:border-[var(--focus)] aria-[invalid=true]:border-crit";

type Row = { included: boolean; apr: string; payment: string };

/** "Mar 2029" for "2029-03"; in Spanish "mar 2029", lower case for the middle of a sentence. */
const when = (month: string | null, t: T) => (month ? monthYear(`${month}-01`, t.locale) : null);
/** "18 months", "2.5 years". */
const years = (months: number, t: T) => (months < 24 ? (months === 1 ? t("1 month") : t("{n} months", { n: months })) : t("{n} years", { n: Math.round(months / 6) / 2 }));

export function DebtPlanner({ debts, today, kept }: { debts: DebtAccount[]; today: ISODate; kept: Cents | null }) {
  const t = useT();
  const id = useId();
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(debts.map((d) => [d.id, { included: d.carried, apr: d.apr === null ? "" : String(d.apr), payment: d.payment === null ? "" : dollarsInput(d.payment) }])),
  );
  const [extraText, setExtraText] = useState("");
  const [view, setView] = useState<PayoffOrder>("avalanche");

  const set = (debtId: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [debtId]: { ...r[debtId]!, ...patch } }));
  const read = (d: DebtAccount) => {
    const row = rows[d.id]!;
    const apr = parseRate(row.apr);
    const payment = parseDollars(row.payment);
    return {
      row,
      apr,
      payment,
      aprError: row.included && apr === null ? t("Its yearly rate, like 6.9") : null,
      paymentError: row.included && (payment === null || payment === 0 || payment > PAYOFF_LIMITS.payment) ? t("What it's paid each month") : null,
    };
  };
  const ticked = debts.filter((d) => rows[d.id]!.included);
  const ready = ticked.every((d) => !read(d).aprError && !read(d).paymentError);
  const extraTyped = extraText.trim() !== "";
  const extra = extraTyped ? parseDollars(extraText) : 0;
  const extraError = extraTyped && (extra === null || extra > PAYOFF_LIMITS.payment) ? t("Type an amount in dollars, like 150.") : null;
  const plan: Debt[] = ticked.map((d) => ({ id: d.id, name: d.name, owed: d.owed, apr: read(d).apr!, payment: read(d).payment! }));
  const result = ticked.length && ready && !extraError ? comparePayoff(plan, extra ?? 0, today) : null;

  return (
    <div>
      <fieldset>
        <legend className="sr-only">{t("Which debts, at what rate and payment")}</legend>
        <ul className="divide-y divide-[var(--line)]">
          {debts.map((d) => {
            const { row, aprError, paymentError } = read(d);
            return (
              <li key={d.id} className="grid grid-cols-2 gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_9rem] sm:items-start">
                <label className="col-span-2 flex min-w-0 items-start gap-3 sm:col-span-1">
                  <input type="checkbox" checked={row.included} onChange={(e) => set(d.id, { included: e.target.checked })} className="mt-1 size-4 shrink-0 accent-[var(--accent)]" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink-1 [overflow-wrap:anywhere]">
                      {d.name}
                      {d.mask ? <span className="font-normal text-ink-3"> ·· {d.mask}</span> : null}
                    </span>
                    <span className="num block text-xs text-ink-3">
                      {d.kind === "credit" && !d.carried
                        ? t("{amount} owed · no interest charged lately, so it looks paid off each month", { amount: money0(d.owed) })
                        : t("{amount} owed", { amount: money0(d.owed) })}
                    </span>
                  </span>
                </label>
                <Field id={`${id}-${d.id}-apr`} label={t("Yearly rate")} suffix="%" value={row.apr} onChange={(v) => set(d.id, { apr: v })} error={aprError} placeholder="6.9" from={d.apr !== null} />
                <Field id={`${id}-${d.id}-pay`} label={t("Pays each month")} prefix="$" value={row.payment} onChange={(v) => set(d.id, { payment: v })} error={paymentError} placeholder="250" from={d.payment !== null} />
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="mt-3 max-w-xs">
        <Field id={`${id}-extra`} label={t("Extra each month, on top")} prefix="$" value={extraText} onChange={setExtraText} error={extraError} placeholder="0" from={false} />
        <p className="mt-1 text-xs text-ink-3">{kept !== null && kept > 0 ? t("You usually keep about {amount} a month.", { amount: money0(kept) }) : t("Even a little extra moves the date.")}</p>
      </div>

      <div aria-live="polite" className="mt-5">
        {result ? (
          <Results result={result} view={view} setView={setView} extra={extra ?? 0} today={today} />
        ) : (
          <p className="text-sm text-ink-3">
            {ticked.length ? t("Add the yearly rate and monthly payment for each ticked debt to see when it's all paid off.") : t("Tick a debt to see when it's paid off.")}{" "}
            {t("Nothing you type here is saved.")}
          </p>
        )}
      </div>
    </div>
  );
}

function Results({ result, view, setView, extra, today }: { result: ReturnType<typeof comparePayoff>; view: PayoffOrder; setView: (o: PayoffOrder) => void; extra: Cents; today: ISODate }) {
  const t = useT();
  const { locale } = t;
  const { avalanche, snowball, minimums, same } = result;
  const plans: Record<PayoffOrder, PayoffPlan> = { avalanche, snowball };
  const cheaper = avalanche.interest < snowball.interest ? "avalanche" : null;
  const sooner = (snowball.cleared[0]?.months ?? Infinity) < (avalanche.cleared[0]?.months ?? Infinity) ? "snowball" : null;
  const shown = plans[view];
  const saved = shown.months !== null && minimums.months !== null ? { interest: minimums.interest - shown.interest, months: minimums.months - shown.months } : null;
  const stuck = minimums.stuck.length ? minimums.cleared.filter((c) => minimums.stuck.includes(c.id)).map((c) => c.name) : [];
  const span = Math.min(CHART_MONTHS, Math.max(shown.owed.length, minimums.owed.length));
  // Past its last month a plan that finished owes nothing; one that never finishes has no line to draw.
  const at = (p: PayoffPlan, i: number) => (i < p.owed.length ? p.owed[i]! : p.months !== null ? 0 : null);
  const months = Array.from({ length: span }, (_, i) => addMonths(startOfMonth(today), i));
  // Each month on its own (a table's row, a tooltip): in Spanish with a capital.
  const labels = months.map((m, i) => (i === 0 ? t("Now") : capitalized(monthYear(m, locale))));
  const cell = (v: Cents | null) => (v === null ? "—" : money0(v));
  const label = t(ORDERS.find((o) => o.order === view)!.label);
  // The order mid-sentence ("…, highest rate first"): lower case in either language.
  const lower = label.toLowerCase();
  // "Visa and Car loan": the stuck debts, named one after another.
  const stuckNames = stuck.length ? stuck.reduce((list, name) => t("{list} and {last}", { list, last: name })) : "";

  return (
    <div className="space-y-4">
      {same ? (
        <p className="text-sm text-ink-2">
          {t("Here both orders work through your debts in the same line: {name} has the highest rate and the smallest balance.", { name: avalanche.cleared[0]!.name })}
        </p>
      ) : null}
      <div role="group" aria-label={t("Which order to show")} className="grid gap-3 sm:grid-cols-2">
        {ORDERS.map(({ order, label: name }) => {
          const p = plans[order];
          const first = p.cleared[0]!;
          return (
            <button
              key={order}
              type="button"
              aria-pressed={view === order}
              onClick={() => setView(order)}
              className={clsx(
                "rounded-ctl border p-4 text-left transition-colors duration-150",
                view === order ? "border-[var(--focus)] bg-surface-2" : "border-line hover:bg-surface-3",
              )}
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink-2">{t(name)}</span>
                {cheaper === order ? <StatusPill status="good">{t("Least interest")}</StatusPill> : null}
                {sooner === order ? <StatusPill status="good">{t("First one gone soonest")}</StatusPill> : null}
              </span>
              <span className="mt-2 block text-[22px] font-extrabold leading-tight tracking-tight text-ink-1">
                {p.debtFree ? t("Debt-free {month}", { month: when(p.debtFree, t)! }) : t("Not at these payments")}
              </span>
              <span className="num mt-1 block text-xs text-ink-3">
                {p.months !== null
                  ? t("{amount} in interest, over {time}", { amount: money0(p.interest), time: years(p.months, t) })
                  : t("{amount} in interest before it stops shrinking", { amount: money0(p.interest) })}
                {first.month ? (
                  <>
                    {" · "}
                    {t("{name} gone {month}", { name: first.name, month: when(first.month, t)! })}
                  </>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-sm text-ink-2">
        {minimums.months !== null ? (
          <>
            {t("Paying only what each one asks: debt-free {month}, {amount} in interest.", { month: when(minimums.debtFree, t)!, amount: money0(minimums.interest) })}
            {saved && saved.months > 0
              ? ` ${
                  extra > 0
                    ? t("{order} with the extra is {time} sooner and {amount} less in interest.", { order: label, time: years(saved.months, t), amount: money0(Math.max(0, saved.interest)) })
                    : t("{order} is {time} sooner and {amount} less in interest.", { order: label, time: years(saved.months, t), amount: money0(Math.max(0, saved.interest)) })
                }`
              : ""}
          </>
        ) : stuck.length === 1 ? (
          t("Paying only what each one asks, {name} never gets paid off: the payment doesn't cover the interest it charges.", { name: stuckNames })
        ) : stuck.length ? (
          t("Paying only what each one asks, {names} never get paid off: the payment doesn't cover the interest it charges.", { names: stuckNames })
        ) : (
          t("Paying only what each one asks takes more than fifty years.")
        )}
      </p>

      <ChartCard
        title={t("What you'd owe, month by month")}
        subtitle={t("{order}, against paying only what each one asks", { order: label })}
        className="shadow-none"
        legend={
          <Legend
            items={[
              { label, color: "var(--accent)", kind: "line" },
              { label: t("Only what each asks"), color: "var(--c-other)", kind: "line" },
            ]}
          />
        }
        table={{
          caption: t("What's owed at the end of each month: {order}, and paying only what each asks", { order: lower }),
          columns: [t("Month"), label, t("Only what each asks")],
          rows: labels.map((l, i) => [l, cell(at(shown, i)), cell(at(minimums, i))]),
        }}
      >
        <TimeSeriesChart
          labels={labels}
          axisLabels={months.map((m, i) => (i === 0 ? t("Now") : `${capitalized(monthShort(m, locale))} ’${m.slice(2, 4)}`))}
          series={[
            { id: "minimums", label: t("Only what each asks"), color: "var(--c-other)", values: labels.map((_, i) => at(minimums, i)), muted: true },
            { id: "plan", label, color: "var(--accent)", values: labels.map((_, i) => at(shown, i)), area: true },
          ]}
          include={0}
          height={220}
          maxAxisLabels={5}
          ariaLabel={
            shown.debtFree
              ? t("What's owed in all: {amount} now, nothing by {month} {order}.", { amount: money0(shown.owed[0]!), month: when(shown.debtFree, t)!, order: lower })
              : t("What's owed in all: {amount} now {order}.", { amount: money0(shown.owed[0]!), order: lower })
          }
        />
      </ChartCard>

      <div>
        <h3 className="text-[13px] font-semibold text-ink-2">{t("{order}: the order they go", { order: label })}</h3>
        <ol className="mt-2 divide-y divide-[var(--line)]">
          {shown.cleared.map((c, i) => (
            <li key={c.id} className="flex items-center gap-3 py-2">
              <span className="num grid size-6 shrink-0 place-items-center rounded-pill bg-surface-2 text-xs font-bold text-ink-2">{i + 1}</span>
              <span className="min-w-0 flex-1 text-sm font-semibold text-ink-1 [overflow-wrap:anywhere]">{c.name}</span>
              <span className="num shrink-0 text-sm text-ink-2">{c.month ? capitalized(when(c.month, t)!) : t("Not at these payments")}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  placeholder,
  prefix,
  suffix,
  from,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  placeholder: string;
  prefix?: string;
  suffix?: string;
  /** The value came from the lender. */
  from: boolean;
}) {
  const t = useT();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      <div className="relative">
        {prefix ? (
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-sm text-ink-3">
            {prefix}
          </span>
        ) : null}
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-note` : undefined}
          className={clsx(field, "num", prefix ? "pl-7" : "pl-3", suffix ? "pr-8" : "pr-3")}
        />
        {suffix ? (
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-sm text-ink-3">
            {suffix}
          </span>
        ) : null}
      </div>
      {error ? (
        <p id={`${id}-note`} className="mt-1 text-xs font-medium text-crit-ink">
          {error}
        </p>
      ) : from ? (
        <p className="mt-1 text-xs text-ink-3">{t("From your lender")}</p>
      ) : null}
    </div>
  );
}
