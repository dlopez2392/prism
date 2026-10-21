// src/lib/finance/fees.ts
//
// Money a person lost without noticing: every fee their bank or card charged
// (overdraft, returned payment, ATM, foreign transaction, late, monthly
// service, cash advance), what came back as a refund, and charges that look
// like they went through twice. The Fees page, its insight and the
// connector read it from here.
//
// A fee is the bank's own category when it says so (Transaction.bankFee, from
// Plaid's BANK_FEES detail). Otherwise, for imported history, the words on the
// line, and only on a line that reads as a bill or as nothing at all, for at
// most FEE_WORDS_MAX: "service fee" on a concert ticket isn't the bank's.
// Interest isn't a fee here; the Cards page and the payoff planner count it.
//
// A fee counts as refunded when money of the same amount comes back to the
// same account within REFUND_DAYS, from the same name or with words that say
// it's a refund. Nothing is stored: it's all read from the transactions.
//
// A possible double charge is two posted lines at the same shop, for the
// same amount, on the same day, in the same account, of at least DOUBLE_MIN.
// That can be right (two tickets), so it's said as a question, never a fact.
//
// Pure: reads the transactions.

import { addDays, daysBetween } from "./dates";
import { money, shortDate } from "./format";
import { EN, msg, type T } from "@/lib/i18n/t";
import { wholeLines } from "./details";
import { normalizeMerchant } from "./merchant";
import type { Cents, FeeKind, ISODate, Transaction } from "./types";

/** A refund counts if it comes back within this many days of the fee. */
export const REFUND_DAYS = 45;
/** Fees are listed for this long. */
export const FEE_DAYS = 365;
/** Double charges are looked for over this many days. */
export const DOUBLE_DAYS = 90;
/** A double charge smaller than this is too likely to be two coffees. */
const DOUBLE_MIN: Cents = 1_000;
/** A line read as a fee from its words alone costs at most this. */
const FEE_WORDS_MAX: Cents = 10_000;

/** The words a bank uses for each fee, in the order they're tried: the specific ones before "service fee". */
const FEE_WORDS: [FeeKind, RegExp][] = [
  ["overdraft", /\boverdraft\b|\bod (item )?fee\b/i],
  ["nsf", /\bnsf\b|\binsufficient funds\b|\breturned (item|payment) fee\b/i],
  ["cash-advance", /\bcash advance fee\b/i],
  ["foreign", /\bforeign (transaction|exchange|currency) fee\b|\binternational (transaction|service) fee\b|\bfx fee\b/i],
  ["atm", /\batm (fee|surcharge|withdrawal fee)\b|\bnon-?network atm\b|\bout-of-network atm\b/i],
  ["late", /\blate (payment )?(fee|charge)\b/i],
  ["maintenance", /\b(monthly )?(maintenance|service|account) (fee|charge)\b|\bmonthly fee\b/i],
];
export const REFUND_WORDS = /\b(refund|reversal|reversed|rebate|courtesy|waive[dr]?|credit adjustment|fee credit)\b/i;

/** Which fee a line is, or null when it isn't one. */
export function feeKind(t: Pick<Transaction, "amount" | "merchant" | "category" | "bankFee" | "interestCharge">): FeeKind | null {
  if (t.amount >= 0 || t.interestCharge) return null;
  if (t.bankFee) return t.bankFee;
  if (t.category !== "bills" && t.category !== "other") return null;
  if (-t.amount > FEE_WORDS_MAX) return null;
  return FEE_WORDS.find(([, words]) => words.test(t.merchant))?.[0] ?? null;
}

export type Fee = {
  id: string;
  accountId: string;
  date: ISODate;
  /** What it cost, positive. */
  amount: Cents;
  kind: FeeKind;
  /** How the bank wrote it. */
  name: string;
  /** The line that gave it back, when one did. */
  refund: { id: string; date: ISODate } | null;
};

export type DoubleCharge = { accountId: string; date: ISODate; merchant: string; amount: Cents; ids: string[] };

export type Fees = {
  /** Every fee in the last FEE_DAYS, newest first. */
  fees: Fee[];
  /** What they cost, and what came back: in the last FEE_DAYS and since January. */
  paid12: Cents;
  refunded12: Cents;
  paidThisYear: Cents;
  /** By kind, what's still lost (paid less refunded) over the last FEE_DAYS, the most first. */
  byKind: { kind: FeeKind; count: number; lost: Cents }[];
  /** Charges that may have gone through twice, newest first. */
  doubles: DoubleCharge[];
};

export function feesFor(txns: Transaction[], today: ISODate): Fees {
  const lines = wholeLines(txns).filter((t) => !t.pending && t.date <= today);
  const since = addDays(today, -FEE_DAYS);
  const year = `${today.slice(0, 4)}-01-01`;
  const used = new Set<string>();
  const fees: Fee[] = [];
  for (const t of lines) {
    if (t.date <= since) continue;
    const kind = feeKind(t);
    if (!kind) continue;
    const name = normalizeMerchant(t.merchant);
    const back = lines.find(
      (r) =>
        !used.has(r.id) &&
        r.accountId === t.accountId &&
        r.amount === -t.amount &&
        r.date >= t.date &&
        daysBetween(t.date, r.date) <= REFUND_DAYS &&
        (REFUND_WORDS.test(r.merchant) || normalizeMerchant(r.merchant) === name || r.bankFee !== undefined),
    );
    if (back) used.add(back.id);
    fees.push({ id: t.id, accountId: t.accountId, date: t.date, amount: -t.amount, kind, name: t.merchant, refund: back ? { id: back.id, date: back.date } : null });
  }
  fees.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.amount - a.amount));

  const kinds = new Map<FeeKind, { count: number; lost: Cents }>();
  for (const f of fees) {
    const k = kinds.get(f.kind) ?? { count: 0, lost: 0 };
    k.count++;
    if (!f.refund) k.lost += f.amount;
    kinds.set(f.kind, k);
  }

  const doubleSince = addDays(today, -DOUBLE_DAYS);
  const groups = new Map<string, Transaction[]>();
  for (const t of lines) {
    if (t.date <= doubleSince || t.amount > -DOUBLE_MIN || t.category === "transfer" || t.category === "income" || feeKind(t)) continue;
    const key = `${t.accountId}|${t.date}|${t.amount}|${normalizeMerchant(t.merchant)}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const doubles = [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => ({ accountId: g[0]!.accountId, date: g[0]!.date, merchant: g[0]!.merchant, amount: -g[0]!.amount, ids: g.map((t) => t.id) }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    fees,
    paid12: fees.reduce((s, f) => s + f.amount, 0),
    refunded12: fees.reduce((s, f) => s + (f.refund ? f.amount : 0), 0),
    paidThisYear: fees.filter((f) => f.date >= year).reduce((s, f) => s + f.amount, 0),
    byKind: [...kinds].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.lost - a.lost || b.count - a.count),
    doubles,
  };
}

/** Each kind of fee, as the page names it (translated where shown). */
export const FEE_LABELS: Record<FeeKind, string> = {
  overdraft: msg("Overdraft fees"),
  nsf: msg("Returned-payment fees"),
  atm: msg("ATM fees"),
  foreign: msg("Foreign transaction fees"),
  late: msg("Late fees"),
  maintenance: msg("Monthly service fees"),
  "cash-advance": msg("Cash advance fees"),
  other: msg("Other bank fees"),
};

/**
 * A polite request for a fee back, for the person to send their bank
 * themselves (Prism never sends it): one whole sentence for each kind, so
 * each language can word it its own way.
 */
export function refundRequest(f: Pick<Fee, "kind" | "amount" | "date">, account: string, t: T = EN): string {
  const v = { amount: money(f.amount), date: shortDate(f.date, t.locale), account };
  const ask = t("I've been a loyal customer, and I'd be grateful if you could refund it as a courtesy. Thank you.");
  const what: Record<FeeKind, string> = {
    overdraft: t("Hello, I see an overdraft fee of {amount} on {date} on my account {account}.", v),
    nsf: t("Hello, I see a returned-payment fee of {amount} on {date} on my account {account}.", v),
    atm: t("Hello, I see an ATM fee of {amount} on {date} on my account {account}.", v),
    foreign: t("Hello, I see a foreign transaction fee of {amount} on {date} on my account {account}.", v),
    late: t("Hello, I see a late fee of {amount} on {date} on my account {account}.", v),
    maintenance: t("Hello, I see a monthly service fee of {amount} on {date} on my account {account}.", v),
    "cash-advance": t("Hello, I see a cash advance fee of {amount} on {date} on my account {account}.", v),
    other: t("Hello, I see a fee of {amount} on {date} on my account {account}.", v),
  };
  return `${what[f.kind]} ${ask}`;
}
