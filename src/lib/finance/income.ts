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
import { EN, msg, type T } from "@/lib/i18n/t";
import type { Cents, IncomeKind, ISODate, Transaction } from "./types";

export const INCOME_LABELS: Record<IncomeKind, string> = {
  pay: msg("Pay"),
  interest: msg("Interest"),
  dividends: msg("Dividends"),
  retirement: msg("Retirement and pensions"),
  benefits: msg("Benefits"),
  "tax-refund": msg("Tax refunds"),
  other: msg("Other income"),
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
const WEEKDAY = [msg("Sunday"), msg("Monday"), msg("Tuesday"), msg("Wednesday"), msg("Thursday"), msg("Friday"), msg("Saturday")];
const NTH = ["", msg("first"), msg("second"), msg("third"), msg("fourth")];
const EVERY: Record<Cadence, string> = {
  weekly: msg("Every week"),
  biweekly: msg("Every two weeks"),
  semimonthly: msg("Twice a month"),
  monthly: msg("Every month"),
  quarterly: msg("Every three months"),
  semiannual: msg("Twice a year"),
  annual: msg("Every year"),
};

/** How a person would say when they're paid, in the language of `t`. */
export function scheduleText(cadence: Cadence, schedule: PaySchedule | undefined, t: T = EN): string {
  if (!schedule) return t(EVERY[cadence]);
  if (schedule.kind === "weekday") {
    const weekday = t(WEEKDAY[schedule.weekday]!);
    return cadence === "weekly" ? t("Every {weekday}", { weekday }) : t("Every other {weekday}", { weekday });
  }
  if (schedule.kind === "nthWeekday") {
    const weekday = t(WEEKDAY[schedule.weekday]!);
    return schedule.nth === -1 ? t("The last {weekday} of each month", { weekday }) : t("The {nth} {weekday} of each month", { nth: t(NTH[schedule.nth]!), weekday });
  }
  // "15th" in English; a day of the month is just its number in Spanish ("el día 15").
  const ord = (d: number) => (t.locale === "en" ? ORDINAL(d) : String(d));
  const [a, b] = schedule.days;
  if (b === undefined) return a! >= 31 ? t("The last day of each month") : t("The {day} of each month", { day: ord(a!) });
  return b >= 31 ? t("The {day} and the last day of each month", { day: ord(a!) }) : t("The {day} and {day2} of each month", { day: ord(a!), day2: ord(b) });
}

export type Paycheck = {
  /** The stream it was found as. */
  id: string;
  payer: string;
  accountId: string;
  kind: IncomeKind;
  cadence: Cadence;
  /** "Every other Friday", "The 15th and the last day of each month": in English, for connected apps; a screen says it in its own language from `schedule`. */
  when: string;
  schedule?: PaySchedule;
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
      schedule: s.schedule,
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
