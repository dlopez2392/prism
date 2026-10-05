// src/lib/finance/income.ts
//
// Who pays you, how often, what actually lands and when it lands next, found
// from the deposits themselves: no payroll login, no second provider. A
// paycheck is a repeating income stream (recurring.ts) that the bank calls pay,
// benefits or a pension, or whose name says so; its schedule is the rule it
// follows, so the next payday is exact. Everything else that comes in is
// counted by kind, as a monthly average over the last three full months.

import { addMonths, monthKey, startOfMonth } from "./dates";
import { perYear, type Cadence, type PaySchedule, type RecurringStream } from "./recurring";
import type { Cents, IncomeKind, ISODate, Transaction } from "./types";

export const INCOME_LABELS: Record<IncomeKind, string> = {
  pay: "Pay",
  interest: "Interest",
  dividends: "Dividends",
  retirement: "Retirement and pensions",
  benefits: "Benefits",
  "tax-refund": "Tax refunds",
  other: "Other income",
};

/** Kinds of income that arrive like a paycheck: on a schedule, for living on. */
const PAYCHECK_KINDS: IncomeKind[] = ["pay", "benefits", "retirement"];

/** What a deposit's name says, when the bank didn't: first match wins. */
const WORDS: [RegExp, IncomeKind][] = [
  [/\b(payroll|salary|direct dep(osit)?|dir dep|paycheck|wages)\b/i, "pay"],
  [/\b(ssa|social security|unemployment|ui benefits?|va benefits?|disability)\b/i, "benefits"],
  [/\b(pension|annuity|retirement)\b/i, "retirement"],
  [/\b(tax ref(und)?|irs treas|state tax)\b/i, "tax-refund"],
  [/\bdividends?\b/i, "dividends"],
  [/\binterest\b/i, "interest"],
];

/** An income transaction's kind: the bank's word for it, else its name's. */
export function incomeKind(t: Pick<Transaction, "incomeKind" | "merchant">): IncomeKind {
  return t.incomeKind ?? WORDS.find(([re]) => re.test(t.merchant))?.[1] ?? "other";
}

/** "Lumen Design Co. payroll" → "Lumen Design Co."; "ACME CORP DIR DEP 0925" → "ACME CORP". */
export function payerName(merchant: string): string {
  const cleaned = merchant
    .replace(/\s*[—–-]?\s*\b(payroll|salary|direct dep(osit)?|dir dep|paycheck|ppd|ach|deposit)\b.*$/i, "")
    .replace(/[\s#*]+\d+$/, "")
    .trim();
  return cleaned || merchant.trim();
}

const ORDINAL = (n: number) => {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${tail}`;
};
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const NTH = ["", "first", "second", "third", "fourth"];
const EVERY: Record<Cadence, string> = {
  weekly: "Every week",
  biweekly: "Every two weeks",
  semimonthly: "Twice a month",
  monthly: "Every month",
  quarterly: "Every three months",
  semiannual: "Twice a year",
  annual: "Every year",
};

/** How a person would say when they're paid. */
export function scheduleText(cadence: Cadence, schedule: PaySchedule | undefined): string {
  if (!schedule) return EVERY[cadence];
  if (schedule.kind === "weekday") return `${cadence === "weekly" ? "Every" : "Every other"} ${WEEKDAY[schedule.weekday]}`;
  if (schedule.kind === "nthWeekday") return `The ${schedule.nth === -1 ? "last" : NTH[schedule.nth]} ${WEEKDAY[schedule.weekday]} of each month`;
  const day = (d: number) => (d >= 31 ? "the last day" : `the ${ORDINAL(d)}`);
  const [a, b] = schedule.days;
  if (b === undefined) return `${cap(day(a!))} of each month`;
  return b >= 31 ? `${cap(day(a!))} and the last day of each month` : `The ${ORDINAL(a!)} and ${ORDINAL(b)} of each month`;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type Paycheck = {
  /** The stream it was found as. */
  id: string;
  payer: string;
  accountId: string;
  kind: IncomeKind;
  cadence: Cadence;
  /** "Every other Friday", "The 15th and the last day of each month". */
  when: string;
  /** What usually lands: the last deposit, or the typical recent one when it varies. */
  takeHome: Cents;
  variable: boolean;
  perYear: number;
  yearly: Cents;
  lastDate: ISODate;
  next: ISODate;
  change: { from: Cents; to: Cents; date: ISODate } | null;
  /** Every deposit it was found from, oldest first. */
  transactionIds: string[];
};

/** The repeating deposits that are pay, benefits or a pension: biggest first. */
export function paychecks(streams: RecurringStream[], txns: Transaction[]): Paycheck[] {
  const byId = new Map(txns.map((t) => [t.id, t]));
  const out: Paycheck[] = [];
  for (const s of streams) {
    if (s.kind !== "income" || s.amount <= 0) continue;
    const last = byId.get(s.transactionIds.at(-1) ?? "");
    const kind = incomeKind(last ?? { merchant: s.merchant });
    if (!PAYCHECK_KINDS.includes(kind)) continue;
    out.push({
      id: s.id,
      payer: payerName(s.merchant),
      accountId: s.accountId,
      kind,
      cadence: s.cadence,
      when: scheduleText(s.cadence, s.schedule),
      takeHome: s.amount,
      variable: s.variable,
      perYear: perYear(s.cadence),
      yearly: s.amount * perYear(s.cadence),
      lastDate: s.lastDate,
      next: s.nextDate,
      change: s.priceChange,
      transactionIds: s.transactionIds,
    });
  }
  return out.sort((a, b) => b.yearly - a.yearly || a.payer.localeCompare(b.payer));
}

export type IncomeSummary = {
  paychecks: Paycheck[];
  /** What the paychecks bring in a month, from their schedules. */
  steadyMonthly: Cents;
  /** The full months the averages cover, oldest first: up to three, and only months the history reaches. */
  months: string[];
  /** Everything that came in, as a monthly average over `months`, by kind (pay included), biggest first. */
  byKind: { kind: IncomeKind; label: string; monthly: Cents }[];
  monthly: Cents;
  /** The next paycheck to land. */
  next: { date: ISODate; amount: Cents; payer: string } | null;
};

export function incomeSummary(txns: Transaction[], streams: RecurringStream[], today: ISODate): IncomeSummary {
  const found = paychecks(streams, txns);
  let earliest: ISODate | null = null;
  for (const t of txns) if (earliest === null || t.date < earliest) earliest = t.date;
  // The last three FULL months, and only those the history covers from their first day.
  const months = [3, 2, 1].map((n) => addMonths(startOfMonth(today), -n)).filter((m) => earliest !== null && earliest <= m).map(monthKey);
  const inMonths = new Set(months);
  const sums = new Map<IncomeKind, Cents>();
  for (const t of txns) {
    if (t.category !== "income" || t.excluded || t.amount <= 0 || t.pending || !inMonths.has(monthKey(t.date))) continue;
    const k = incomeKind(t);
    sums.set(k, (sums.get(k) ?? 0) + t.amount);
  }
  const byKind = [...sums]
    .map(([kind, total]) => ({ kind, label: INCOME_LABELS[kind], monthly: Math.round(total / months.length) }))
    .filter((k) => k.monthly > 0)
    .sort((a, b) => b.monthly - a.monthly);
  const next = found.reduce<Paycheck | null>((soonest, p) => (soonest === null || p.next < soonest.next ? p : soonest), null);
  return {
    paychecks: found,
    steadyMonthly: Math.round(found.reduce((s, p) => s + p.yearly, 0) / 12),
    months,
    byKind,
    monthly: byKind.reduce((s, k) => s + k.monthly, 0),
    next: next ? { date: next.next, amount: next.takeHome, payer: next.payer } : null,
  };
}
