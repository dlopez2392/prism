// src/lib/finance/schedule-c.ts
//
// Business categories and the Schedule C summary: every line in the person's
// business accounts (finance/business.ts) put where it goes on Schedule C,
// the form a sole proprietor or a single-member LLC reports its profit on.
// Money in is gross receipts (line 1) or other income (line 6); money out is
// one of Part II's costs (lines 8 to 27a) or cost of goods sold (Part III).
// Two places aren't on the form at all: money the person put in or took out
// for themselves (`owner`), and what wasn't the business's (`personal`).
//
// Where a line goes, most certain first:
//   1. what the person said about that line;
//   2. what they said about every line from its shop going the same way;
//   3. Prism's guess: the name (a payroll service is wages, a card
//      processor's fee is a fee), then the line's own category (a
//      restaurant is a meal, a gas station is the car).
// Money back from a purchase (a supplier's refund) goes where the purchase
// went, and takes from it. A transfer between two business accounts was
// never here (businessLines).
//
// It finds and sorts; it never advises. The totals are what the bank saw,
// not what the form will say: a meal usually counts at half, and what Prism
// can't see (a home office, miles in a personal car, equipment that's
// depreciated) is for the person or their preparer to add. Pure: the
// Business page, Taxes, the download and the connector all read this.

import { businessLines } from "./business";
import { isSpendCategory } from "./categories";
import { bizLineFits, bizShopKey, type BizLine, type BizMarks, type BizSide } from "./details";
import { incomeKind } from "./income";
import { EN, msg, type T } from "@/lib/i18n/t";
import type { Account, CategoryId, Cents, FinanceData, ISODate, Transaction } from "./types";
import { yearSpan } from "./year";

export type { BizLine, BizSide };

/** Each place, in the order the form asks, with its line on Schedule C (null: not on it). Titles are marked here and said in the language of `t`. */
export const BIZ_LINE_INFO: Record<BizLine, { line: string | null; title: string }> = {
  sales: { line: "1", title: msg("Sales and gross receipts") },
  "other-income": { line: "6", title: msg("Other income") },
  goods: { line: "4", title: msg("Cost of goods sold") },
  advertising: { line: "8", title: msg("Advertising") },
  car: { line: "9", title: msg("Car and truck") },
  commissions: { line: "10", title: msg("Commissions and fees") },
  "contract-labor": { line: "11", title: msg("Contract labor") },
  insurance: { line: "15", title: msg("Insurance (not health)") },
  interest: { line: "16b", title: msg("Interest") },
  legal: { line: "17", title: msg("Legal and professional services") },
  office: { line: "18", title: msg("Office expense") },
  rent: { line: "20b", title: msg("Rent or lease") },
  repairs: { line: "21", title: msg("Repairs and maintenance") },
  supplies: { line: "22", title: msg("Supplies") },
  taxes: { line: "23", title: msg("Taxes and licenses") },
  travel: { line: "24a", title: msg("Travel") },
  meals: { line: "24b", title: msg("Meals") },
  utilities: { line: "25", title: msg("Utilities and phone") },
  wages: { line: "26", title: msg("Wages") },
  "other-expense": { line: "27a", title: msg("Other expenses") },
  owner: { line: null, title: msg("Paid to you, or put in by you") },
  personal: { line: null, title: msg("Not the business's") },
};

/** The costs, in the form's order: Part III's goods first, then Part II. */
export const COST_LINES: readonly BizLine[] = [
  "goods",
  "advertising",
  "car",
  "commissions",
  "contract-labor",
  "insurance",
  "interest",
  "legal",
  "office",
  "rent",
  "repairs",
  "supplies",
  "taxes",
  "travel",
  "meals",
  "utilities",
  "wages",
  "other-expense",
];

/** Net profit at or above this usually means self-employment tax (Schedule SE). */
export const SE_TAX_FROM: Cents = 40_000;

/** Which way a line's money went: in, or out (money back from a purchase undoes part of one, so it goes the purchase's way). */
export function bizSide(t: Pick<Transaction, "amount" | "category">): BizSide {
  return t.amount < 0 || isSpendCategory(t.category) ? "out" : "in";
}

/** Where a category's spending most likely goes. */
const BY_CATEGORY: Partial<Record<CategoryId, BizLine>> = {
  food: "meals",
  travel: "travel",
  transport: "car",
  housing: "rent",
  bills: "utilities",
  shopping: "supplies",
};

/** Categories where a plain word in a name may mean what it says: never food, fun or travel ("Power Burger", "Water Park"). */
const PLAIN: ReadonlySet<CategoryId> = new Set<CategoryId>(["bills", "other", "housing", "shopping", "transport", "transfer"]);

/** Names, first match wins. `plain`: a common word, trusted only in PLAIN categories. */
const WORDS: { line: BizLine; words: RegExp; plain?: true }[] = [
  { line: "commissions", words: /\b(stripe|square|paypal|shopify|etsy|ebay|amazon seller|merchant|processing|transaction|card) (fees?|charges?)\b|\b(stripe|square) fee\b/i },
  { line: "wages", words: /\b(gusto|adp|paychex|payroll|rippling|justworks|onpay|quickbooks payroll)\b/i },
  { line: "contract-labor", words: /\b(upwork|fiverr|toptal|contractors?|freelancers?)\b/i },
  {
    line: "advertising",
    words: /\b(google ads|adwords|facebook ads|facebk|fb ads|meta ads|meta platforms|linkedin ads|tiktok ads|yelp|nextdoor|thumbtack|angi|mailchimp|constant contact|vistaprint|advertis\w*)\b/i,
  },
  { line: "legal", words: /\b(attorneys?|lawyers?|law (office|firm|group)|legalzoom|cpa|accountants?|accounting|bookkeep\w*|tax prep\w*|h&r block)\b/i },
  { line: "insurance", words: /\b(hiscox|next insurance|the hartford|business insurance|liability insurance|general liability)\b/i },
  {
    line: "office",
    words:
      /\b(staples|office depot|officemax|usps|post office|stamps\.com|the ups store|fedex office|quickbooks|xero|freshbooks|wave apps|adobe|microsoft|google workspace|g suite|gsuite|dropbox|zoom\.us|zoom video|slack|notion|canva|github|squarespace|wix|godaddy|namecheap|amazon web services|aws|calendly|docusign|1password)\b/i,
  },
  // Your own income tax isn't a business cost: a payment to the IRS from a business account is money taken out.
  { line: "owner", words: /\b(irs|usataxpymt|estimated tax|owner'?s? draw|draw)\b/i },
  { line: "taxes", words: /\b(sales tax|licen[cs]es?|permits?|secretary of state|franchise tax|business tax|eftps)\b/i },
  { line: "insurance", words: /\b(insurance|insur\w*)\b/i, plain: true },
  { line: "utilities", words: /\b(verizon|at&t|t-mobile|tmobile|comcast|xfinity|spectrum|cox communications|electric\w*|power|energy|water|utilit\w*|internet|phone|wireless)\b/i, plain: true },
  { line: "rent", words: /\b(rent|lease|regus|wework|coworking|self storage|public storage|storage)\b/i, plain: true },
  { line: "repairs", words: /\b(repairs?|maintenance)\b/i, plain: true },
  { line: "car", words: /\b(shell|chevron|exxon|mobil|valero|texaco|sunoco|citgo|marathon|speedway|wawa|sheetz|fuel|gas station|parking|tolls?|ez ?pass|jiffy lube|car wash)\b/i, plain: true },
];

/** Prism's guess for a business line, before anything the person said. */
export function guessBizLine(t: Transaction): BizLine {
  const side = bizSide(t);
  if (side === "in") {
    if (t.category === "transfer") return "owner";
    const kind = incomeKind(t);
    return kind === "interest" || kind === "dividends" ? "other-income" : "sales";
  }
  if (t.interestCharge) return "interest";
  if (t.bankFee) return "other-expense";
  if (t.taxHint === "tax-payment") return /\b(sales tax|licen[cs]es?|permits?|franchise tax|business tax|eftps)\b/i.test(t.merchant) ? "taxes" : "owner";
  for (const w of WORDS) {
    if (w.plain && !PLAIN.has(t.category)) continue;
    if (w.words.test(t.merchant)) return w.line;
  }
  // Money sent to another account of the person's: taken out for themselves.
  if (t.category === "transfer") return "owner";
  return BY_CATEGORY[t.category] ?? "other-expense";
}

/** A business line with where it goes, and on whose word. */
export type BizTxn = Transaction & {
  biz: BizLine;
  /** "you": the person put this line there; "shop": every line from its shop goes there; "guess": Prism's guess. */
  how: "you" | "shop" | "guess";
  side: BizSide;
  /** What the person said about this line, and about its shop going this way, if anything: what an Undo puts back. */
  own: BizLine | null;
  shop: BizLine | null;
  guess: BizLine;
};

/** Each line in the business accounts, put where it goes. */
export function sortBusiness(lines: Transaction[], marks: BizMarks | undefined): BizTxn[] {
  return lines.map((t) => {
    const side = bizSide(t);
    const key = bizShopKey(side, t.merchant);
    // A line's own word must still fit its side (a line can't have changed sides, but a stored mark is never trusted blind).
    const ownRaw = marks && Object.hasOwn(marks.lines, t.id) ? marks.lines[t.id]! : null;
    const own = ownRaw && bizLineFits(side, ownRaw) ? ownRaw : null;
    const shop = marks && key !== null && Object.hasOwn(marks.shops, key) ? marks.shops[key]!.line : null;
    const guess = guessBizLine(t);
    return { ...t, biz: own ?? shop ?? guess, how: own ? "you" : shop ? "shop" : "guess", side, own, shop, guess };
  });
}

export type ScheduleLine = {
  id: BizLine;
  /** Its line on Schedule C. */
  line: string;
  title: string;
  /** Positive cents: what it cost, less what came back. */
  total: Cents;
  /** Newest first. */
  lines: BizTxn[];
};

export type ScheduleC = {
  year: number;
  from: ISODate;
  to: ISODate;
  partial: boolean;
  recordsFrom: ISODate | null;
  accounts: Account[];
  /** Line 1: what customers paid. */
  receipts: Cents;
  /** Line 2: what was paid back to customers. */
  returns: Cents;
  /** Line 6. */
  otherIncome: Cents;
  /** Part III and Part II, in the form's order: only those with something in them. */
  costs: ScheduleLine[];
  costsTotal: Cents;
  /** Receipts less returns, plus other income, less every cost: what the bank saw, not the form's line 31. */
  net: Cents;
  /** Money the person put in, and took out, for themselves: not on the form. */
  owner: { in: Cents; out: Cents; lines: BizTxn[] };
  /** What wasn't the business's: not on the form. */
  personal: { total: Cents; lines: BizTxn[] };
  /** How many lines are still where Prism guessed. */
  guessed: number;
  /** Every line in the span, newest first. */
  lines: BizTxn[];
};

const newestFirst = (a: Transaction, b: Transaction) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? 1 : -1);

/** The year's Schedule C, its titles in the language of `t`; null when no account is marked as business. */
export function scheduleC(
  data: Pick<FinanceData, "transactions" | "today" | "businessAccountIds" | "businessMarks" | "hiddenAccounts" | "accounts">,
  year: number,
  t: T = EN,
): ScheduleC | null {
  const ids = new Set(data.businessAccountIds ?? []);
  const accounts = [...(data.hiddenAccounts ?? []), ...data.accounts].filter((a, i, all) => ids.has(a.id) && all.findIndex((b) => b.id === a.id) === i);
  if (!accounts.length) return null;
  const { from, to, partial, recordsFrom } = yearSpan(data, year);
  const lines = sortBusiness(
    businessLines(
      accounts.map((a) => a.id),
      data.transactions,
      data.today,
    ).filter((x) => x.date >= from && x.date <= to),
    data.businessMarks,
  ).sort(newestFirst);

  let receipts = 0;
  let returns = 0;
  let otherIncome = 0;
  const byLine = new Map<BizLine, BizTxn[]>();
  const owner = { in: 0, out: 0, lines: [] as BizTxn[] };
  const personal = { total: 0, lines: [] as BizTxn[] };
  for (const x of lines) {
    if (x.biz === "sales") {
      if (x.side === "in") receipts += x.amount;
      else returns -= x.amount;
    } else if (x.biz === "other-income") otherIncome += x.amount;
    else if (x.biz === "owner") {
      if (x.amount > 0) owner.in += x.amount;
      else owner.out -= x.amount;
      owner.lines.push(x);
    } else if (x.biz === "personal") {
      personal.total -= x.amount;
      personal.lines.push(x);
    } else byLine.set(x.biz, [...(byLine.get(x.biz) ?? []), x]);
  }
  const costs: ScheduleLine[] = [];
  for (const id of COST_LINES) {
    const found = byLine.get(id);
    if (!found?.length) continue;
    costs.push({ id, line: BIZ_LINE_INFO[id].line!, title: t(BIZ_LINE_INFO[id].title), total: -found.reduce((s, x) => s + x.amount, 0), lines: found });
  }
  const costsTotal = costs.reduce((s, c) => s + c.total, 0);
  return {
    year,
    from,
    to,
    partial,
    recordsFrom,
    accounts,
    receipts,
    returns,
    otherIncome,
    costs,
    costsTotal,
    net: receipts - returns + otherIncome - costsTotal,
    owner,
    personal: { total: personal.total, lines: personal.lines },
    guessed: lines.filter((x) => x.how === "guess").length,
    lines,
  };
}

/** A place's name with its line, in the language of `t`: "Line 8 · Advertising", or the name alone when it isn't on the form. Sales going out are refunds to customers, line 2. */
export function bizLineLabel(id: BizLine, t: T = EN, side: BizSide = "in"): string {
  if (id === "sales" && side === "out") return t("Line {line} · {title}", { line: "2", title: t("Refunds to customers") });
  const info = BIZ_LINE_INFO[id];
  return info.line ? t("Line {line} · {title}", { line: info.line, title: t(info.title) }) : t(info.title);
}
