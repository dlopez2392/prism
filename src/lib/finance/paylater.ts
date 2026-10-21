// src/lib/finance/paylater.ts
//
// Buy now, pay later: plans with Affirm, Klarna, Afterpay, Sezzle and Zip,
// found from the payments to them, because no aggregator reports the plans
// themselves. The Cards page and the connector read it from here.
//
// A plan is a run of payments to one provider, for the same amount (within a
// cent or two), from the same account:
//   - every two weeks, as "pay in 4" plans go: four payments, the first at
//     checkout. Payments still to come are four less those seen, and the
//     next one is two weeks after the last; a run of four is paid off;
//   - every month, as longer plans go: how many are left the payments don't
//     say, so it's an ongoing monthly payment with no total owed.
// A plan whose next payment is overdue by more than GRACE_DAYS has ended (or
// is being paid another way) and isn't listed as active.
//
// What's owed is only what the payments show: a plan whose first payments
// came before the history Prism holds can look shorter than it is, so the
// page says "at least".
//
// Pure: reads the transactions.

import { addDays, addMonths, daysBetween } from "./dates";
import { wholeLines } from "./details";
import type { Cents, ISODate, Transaction } from "./types";

export type PayLaterProvider = "affirm" | "klarna" | "afterpay" | "sezzle" | "zip";

const PROVIDERS: [PayLaterProvider, RegExp][] = [
  ["affirm", /\baffirm\b/i],
  ["klarna", /\bklarna\b/i],
  ["afterpay", /\bafterpay\b|\bclearpay\b/i],
  ["sezzle", /\bsezzle\b/i],
  ["zip", /\bzip\.co\b|\bzip pay\b|\bquadpay\b/i],
];
export const PROVIDER_NAMES: Record<PayLaterProvider, string> = { affirm: "Affirm", klarna: "Klarna", afterpay: "Afterpay", sezzle: "Sezzle", zip: "Zip" };

/** How long a plan's next payment may be late before the plan counts as over. */
const GRACE_DAYS = 10;
/** Payments are looked for over this long. */
const LOOKBACK_DAYS = 400;
/** Amounts within this of each other are the same installment. */
const SAME: Cents = 2;
const PAY_IN_4 = 4;

/** The provider a bank line was paid to, or null. */
export function payLaterOf(merchant: string): PayLaterProvider | null {
  return PROVIDERS.find(([, re]) => re.test(merchant))?.[0] ?? null;
}

export type PayLaterPlan = {
  provider: PayLaterProvider;
  accountId: string;
  /** Each payment, positive. */
  installment: Cents;
  cadence: "biweekly" | "monthly";
  /** Payments seen, oldest first. */
  paid: { id: string; date: ISODate }[];
  /** Pay-in-4: payments still to come (0 when it's paid off); null for a monthly plan, whose length the payments don't show. */
  left: number | null;
  /** What's still to pay, as far as the payments show; null for a monthly plan. */
  owed: Cents | null;
  /** The next payment, while the plan is running. */
  next: ISODate | null;
};

export type PayLater = {
  /** Plans still running, the next payment first. */
  active: PayLaterPlan[];
  /** Pay-in-4 plans paid off in the last 90 days. */
  finished: PayLaterPlan[];
  /** At least this much still to pay across the pay-in-4 plans. */
  owed: Cents;
  /** What the running plans take a month, the biweekly ones counted at their pace. */
  monthly: Cents;
  /** Payments in the next 30 days. */
  next30: Cents;
};

/** Split one provider's payments from one account into runs of the same amount on a steady rhythm. */
function runs(lines: Transaction[]): Transaction[][] {
  const byAmount: Transaction[][] = [];
  for (const t of lines) {
    const group = byAmount.find((g) => Math.abs(g[0]!.amount - t.amount) <= SAME);
    if (group) group.push(t);
    else byAmount.push([t]);
  }
  // Within one amount, a gap of more than ~45 days starts a new plan.
  const out: Transaction[][] = [];
  for (const g of byAmount) {
    g.sort((a, b) => (a.date < b.date ? -1 : 1));
    let run: Transaction[] = [];
    for (const t of g) {
      if (run.length && daysBetween(run.at(-1)!.date, t.date) > 45) {
        out.push(run);
        run = [];
      }
      run.push(t);
      // A pay-in-4 plan never has a fifth payment two weeks on: that's a new plan for the same amount.
      if (run.length === PAY_IN_4 && daysBetween(run[0]!.date, t.date) <= 56) {
        out.push(run);
        run = [];
      }
    }
    if (run.length) out.push(run);
  }
  return out;
}

export function payLaterFor(txns: Transaction[], today: ISODate): PayLater {
  const since = addDays(today, -LOOKBACK_DAYS);
  const groups = new Map<string, Transaction[]>();
  for (const t of wholeLines(txns)) {
    if (t.pending || t.amount >= 0 || t.date < since || t.date > today) continue;
    const p = payLaterOf(t.merchant);
    if (!p) continue;
    const key = `${p}|${t.accountId}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const active: PayLaterPlan[] = [];
  const finished: PayLaterPlan[] = [];
  for (const [key, lines] of groups) {
    const provider = key.split("|")[0] as PayLaterProvider;
    for (const run of runs(lines)) {
      const last = run.at(-1)!;
      const gaps = run.slice(1).map((t, i) => daysBetween(run[i]!.date, t.date));
      const typical = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null;
      // One payment alone: a pay-in-4 plan just started at checkout (the usual first sight of one).
      const cadence: PayLaterPlan["cadence"] = typical === null || typical <= 20 ? "biweekly" : "monthly";
      const installment = -last.amount;
      const paid = run.map((t) => ({ id: t.id, date: t.date }));
      if (cadence === "biweekly") {
        const left = Math.max(0, PAY_IN_4 - run.length);
        const next = left > 0 ? addDays(last.date, 14) : null;
        const plan: PayLaterPlan = { provider, accountId: last.accountId, installment, cadence, paid, left, owed: left * installment, next };
        if (left === 0) {
          if (daysBetween(last.date, today) <= 90) finished.push(plan);
        } else if (daysBetween(next!, today) <= GRACE_DAYS) active.push(plan);
      } else {
        const next = addMonths(last.date, 1);
        if (daysBetween(next, today) <= GRACE_DAYS) active.push({ provider, accountId: last.accountId, installment, cadence, paid, left: null, owed: null, next });
      }
    }
  }
  active.sort((a, b) => (a.next! < b.next! ? -1 : 1));
  finished.sort((a, b) => (a.paid.at(-1)!.date < b.paid.at(-1)!.date ? 1 : -1));

  const in30 = addDays(today, 30);
  let next30 = 0;
  for (const p of active) {
    const step = (d: ISODate) => (p.cadence === "biweekly" ? addDays(d, 14) : addMonths(d, 1));
    let remaining = p.left ?? Infinity;
    for (let d = p.next!; d <= in30 && remaining > 0; d = step(d), remaining--) if (d >= today) next30 += p.installment;
  }
  return {
    active,
    finished,
    owed: active.reduce((s, p) => s + (p.owed ?? 0), 0),
    monthly: active.reduce((s, p) => s + (p.cadence === "monthly" ? p.installment : Math.round((p.installment * 26) / 12)), 0),
    next30,
  };
}
