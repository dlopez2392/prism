// src/lib/finance/taxes.ts
//
// The tax summary (/taxes): one year of a person's money sorted into what a
// US tax return asks about. Money in: pay, interest, dividends, benefits,
// other money and refunds. Money out: gifts to charity, medical bills, taxes
// already paid, mortgage and student-loan payments, childcare and tuition.
// Each section carries the transactions behind it and the form that holds
// the official figure.
//
// It finds; it never advises. A bank line is what landed, not what a form
// says (take-home pay isn't wages; a mortgage payment isn't its interest), so
// every section names the form to trust over it, and nothing here adds up a
// deduction or guesses a tax. Pure: the page, the download and the AI
// connector all read this one summary.
//
// How a line is found, most certain first:
//   1. The bank's own category (Transaction.taxHint, from Plaid), unless the
//      person has since moved the line to another category: their word wins.
//   2. Its name: the merchant, and for a Venmo, PayPal or Cash App payment
//      the person made, who it went to and the note they wrote (p2p.ts).
//      Names match whole words, only in categories where they can mean what
//      they say, and the names that fool a word list are refused: Church's
//      Chicken isn't a church, a thrift store sells things, and a gift to a
//      campaign isn't a gift to charity.
// Pending lines, future dates and transfers between the person's own
// accounts never count.

import { isSpendCategory } from "./categories";
import { incomeKind } from "./income";
import { EN, msg, type T } from "@/lib/i18n/t";
import type { CategoryId, Cents, FinanceData, IncomeKind, ISODate, TaxHint, Transaction } from "./types";
import { reviewYears, yearSpan } from "./year";

export type TaxSectionId =
  | "pay"
  | "interest"
  | "dividends"
  | "benefits"
  | "other-income"
  | "refunds"
  | "gifts"
  | "medical"
  | "taxes-paid"
  | "mortgage"
  | "student-loans"
  | "childcare"
  | "education";

export type TaxSection = {
  id: TaxSectionId;
  /** Money in, or money out. */
  side: "in" | "out";
  title: string;
  /** The form that holds the official figure, when one does. */
  form: string | null;
  /** What it means for a return, in a sentence or three. */
  note: string;
  /** Positive cents: what came in, or what went out less any money back. */
  total: Cents;
  /** Newest first. */
  lines: Transaction[];
};

export type TaxSummary = {
  year: number;
  /** The span counted: Jan 1 (or the first record) to Dec 31 (or today). */
  from: ISODate;
  to: ISODate;
  /** The year is still under way. */
  partial: boolean;
  /** Prism's records start after Jan 1 of this year: the first day it can see. */
  recordsFrom: ISODate | null;
  /** The sections with something in them, in the order a return asks. */
  sections: TaxSection[];
  /** The sections Prism looked for and found nothing in. */
  nothing: { id: TaxSectionId; title: string }[];
  /** Gifts to a campaign or a party: left out of gifts to charity, and said so. */
  political: Transaction[];
  /** Every transaction in the span. */
  transactions: number;
};

/** A single gift this big needs the charity's written receipt to be deducted (IRS Publication 526). */
export const GIFT_RECEIPT_FROM: Cents = 25_000;

// Titles are marked here and translated by taxSummary; each note is said in the language of `t` (English unless a screen asks).
type Spec = { id: TaxSectionId; side: "in" | "out"; title: string; form: string | null; note: (year: number, t: T) => string };

export const TAX_SECTIONS: Spec[] = [
  {
    id: "pay",
    side: "in",
    title: msg("Pay"),
    form: "W-2",
    note: (_year, t) => t("What landed in your accounts, after taxes and deductions came out. Your W-2 shows what you earned before them, and that's the figure your return needs."),
  },
  {
    id: "interest",
    side: "in",
    title: msg("Interest"),
    form: "1099-INT",
    note: (_year, t) => t("Interest is taxable. Each bank that paid you $10 or more sends a 1099-INT by early February."),
  },
  {
    id: "dividends",
    side: "in",
    title: msg("Dividends"),
    form: "1099-DIV",
    note: (_year, t) => t("Dividends are taxable, even when they're reinvested. Your brokerage sends a 1099-DIV."),
  },
  {
    id: "benefits",
    side: "in",
    title: msg("Benefits, pensions and retirement"),
    form: "1099-G, SSA-1099 or 1099-R",
    note: (_year, t) => t("Unemployment shows on a 1099-G, Social Security on an SSA-1099, and pensions and retirement withdrawals on a 1099-R. Some or all of it can be taxable."),
  },
  {
    id: "other-income",
    side: "in",
    title: msg("Other money in"),
    form: "1099-NEC or 1099-K",
    note: (_year, t) =>
      t("Money from clients, side work or selling things online can be taxable even when no form arrives. Nothing was taken out of it for taxes, so a large amount can mean a bill in April, or quarterly estimated payments."),
  },
  {
    id: "refunds",
    side: "in",
    title: msg("Tax refunds"),
    form: "1099-G",
    note: (_year, t) => t("A federal refund isn't income. A state or local refund can be, if you itemized the year before; your state sends a 1099-G."),
  },
  {
    id: "gifts",
    side: "out",
    title: msg("Gifts to charity"),
    form: null,
    note: (year, t) =>
      year >= 2026
        ? t(
            "From 2026, up to $1,000 of cash gifts to charity ($2,000 filing jointly) can be deducted even if you don't itemize. Keep the charity's written receipt for any single gift of $250 or more. Gifts to campaigns, parties or people aren't deductible.",
          )
        : t("Keep the charity's written receipt for any single gift of $250 or more. Gifts to campaigns, parties or people aren't deductible."),
  },
  {
    id: "medical",
    side: "out",
    title: msg("Medical and dental"),
    form: null,
    note: (_year, t) =>
      t("Doctors, dentists, eye care, prescriptions and hospitals. They lower your taxes only if you itemize, and only the part above 7.5% of your adjusted gross income. A pharmacy's total is everything bought there, so count only the medicine."),
  },
  {
    id: "taxes-paid",
    side: "out",
    title: msg("Taxes you paid"),
    form: null,
    note: (_year, t) =>
      t("Payments to the IRS, your state and your county. An estimated payment counts toward the year it was for, so one made in January or April may belong to the year before. State, local and property taxes can be deducted if you itemize, up to a limit."),
  },
  {
    id: "mortgage",
    side: "out",
    title: msg("Mortgage payments"),
    form: "1098",
    note: (_year, t) => t("Only the interest can be deducted, and only if you itemize. Your lender's 1098 shows how much of these payments was interest."),
  },
  {
    id: "student-loans",
    side: "out",
    title: msg("Student loan payments"),
    form: "1098-E",
    note: (_year, t) => t("Up to $2,500 of the interest can lower your taxable income even if you don't itemize, depending on what you earn. Your loan servicer's 1098-E shows it."),
  },
  {
    id: "childcare",
    side: "out",
    title: msg("Childcare"),
    form: null,
    note: (_year, t) => t("Care for a child under 13 while you work may qualify for the Child and Dependent Care Credit. You'll need each provider's name, address and tax ID."),
  },
  {
    id: "education",
    side: "out",
    title: msg("Tuition and school"),
    form: "1098-T",
    note: (_year, t) => t("College costs may qualify for the American Opportunity or Lifetime Learning credit, and the school's 1098-T shows what counts. School before college usually doesn't."),
  },
];

const IN_SECTION: Record<IncomeKind, TaxSectionId> = {
  pay: "pay",
  interest: "interest",
  dividends: "dividends",
  retirement: "benefits",
  benefits: "benefits",
  "tax-refund": "refunds",
  other: "other-income",
};

const HINT_SECTION: Record<TaxHint, TaxSectionId> = {
  donation: "gifts",
  "tax-payment": "taxes-paid",
  medical: "medical",
  childcare: "childcare",
  education: "education",
  mortgage: "mortgage",
  "student-loan": "student-loans",
};

/** Where money can come back (the dentist refunds a deposit), and is taken off what went out. */
const REFUNDABLE = new Set<TaxSectionId>(["medical", "childcare", "education"]);

/** A payment the person made through Venmo, PayPal or Cash App: its bank line is a transfer, but who it went to is known. */
const paidByApp = (t: Transaction) => t.p2p?.dir === "to";

/** The words a line is known by: its merchant, and for an app payment the person made, who it went to and (optionally) their own note. */
function nameOf(t: Transaction, withNote: boolean): string {
  if (!paidByApp(t)) return t.merchant;
  return [t.merchant, t.p2p!.name, withNote ? t.p2p!.note : null].filter(Boolean).join(" ");
}

/** Gifts to a campaign or a party: never a gift to charity. */
const POLITICAL = /\b(actblue|winred|anedot|for (congress|senate|president|governor|mayor|state senate|assembly)|campaign (committee|for)|victory fund|political|pac|dnc|rnc|democrats|republicans|democratic party|republican party|gop)\b/i;

/** Names that look like a medical bill and aren't one. */
const NOT_MEDICAL = /\b(gym|fitness|yoga|pilates|crossfit|spa|salon|barber\w*|beauty|nails?|massage|vet|veterinary|animal|pet\w*|supplements?|vitamins?|nutrition|gnc)\b/i;

/** Names that look like a gift and aren't one. */
const NOT_GIFT = /\b(church'?s chicken|church (st|street|ave|avenue|rd|road|blvd)|thrift)\b/i;

// Where a name may mean what it says: never food, fun, travel or transport ("University Pizza", "Church Street Garage").
const NAMED = new Set<CategoryId>(["other", "bills", "housing", "health", "shopping"]);

/** A name's section, first match wins; `where` is the extra rule a category must meet. */
const WORDS: { id: TaxSectionId; words: RegExp; where?: (t: Transaction) => boolean; notes?: false }[] = [
  {
    id: "taxes-paid",
    words: /\b(irs|eftps|usataxpymt|franchise tax board|(dept|department) of (revenue|taxation)|comptroller|tax collector|property tax(es)?|county tax|county treasurer|state tax payment|estimated tax)\b/i,
  },
  { id: "mortgage", words: /\b(mortgage|mtg|home loan|mr\.? ?cooper)\b/i },
  {
    id: "student-loans",
    words: /\b(student loans?|stdnt loan|navient|nelnet|mohela|aidvantage|edfinancial|fedloan|sallie mae|(dept|department) of ed(ucation)?|great lakes ed\w*|ecmc)\b/i,
  },
  {
    id: "childcare",
    words: /\b(day ?care|child ?care|pre-?school|nann(y|ies)|babysit\w*|after ?school|before ?school|kindercare|bright horizons|la petite|goddard school|primrose school|learning care|tutor time|day camp)\b/i,
  },
  {
    id: "medical",
    words:
      /\b(pharmacy|pharmacies|rx|cvs|walgreens|rite aid|dental|dentist\w*|orthodont\w*|doctors?|physicians?|clinic|hospital|medical|health ?care|urgent ?care|minuteclinic|pediatric\w*|dermatolog\w*|optometr\w*|ophthalm\w*|eye ?care|labcorp|lab corp|quest diagnostics|radiology|imaging|physical therapy|chiropract\w*|counsel(ing|or)|therap(y|ist)|psychiatr\w*|psycholog\w*|hearing aids?|copay)\b/i,
    where: (t) => (t.category === "health" || paidByApp(t)) && !NOT_MEDICAL.test(nameOf(t, true)),
  },
  {
    id: "gifts",
    words:
      /\b(donat(e|es|ed|ion|ions)|charit(y|ies|able)|church|parish|synagogue|mosque|ministries|tithes?|tithing|red cross|united way|st\.? jude|unicef|habitat for humanity|food bank|food pantry|feeding america|doctors without borders|aspca|humane society|world vision|compassion international|wikimedia)\b/i,
    where: (t) => (t.category === "other" || t.category === "bills" || paidByApp(t)) && !NOT_GIFT.test(nameOf(t, false)),
    // A note like "donation for Sam's party" names no charity: only who was paid counts here.
    notes: false,
  },
  {
    id: "education",
    words: /\b(tuition|bursar|university|community college|student accounts?)\b/i,
    where: (t) => !/\b(credit union|hospital|medical|health|clinic|parking|athletics|tickets?)\b/i.test(t.merchant),
  },
];

type Found = { id: TaxSectionId } | { political: true } | null;

/** Which section a line of money out belongs to, if any. */
function outSection(t: Transaction): Found {
  // The bank's word, unless the person has since said otherwise.
  if (t.taxHint && t.bankCategory === undefined) {
    const id = HINT_SECTION[t.taxHint];
    if (id === "gifts" && POLITICAL.test(nameOf(t, false))) return { political: true };
    // The bank's pharmacies include vitamin shops.
    return id === "medical" && NOT_MEDICAL.test(nameOf(t, true)) ? null : { id };
  }
  // A transfer between the person's own accounts is never anything here.
  if (!NAMED.has(t.category) && !paidByApp(t)) return null;
  for (const w of WORDS) {
    if (!w.words.test(nameOf(t, w.notes !== false)) || (w.where && !w.where(t))) continue;
    return w.id === "gifts" && POLITICAL.test(nameOf(t, false)) ? { political: true } : { id: w.id };
  }
  return null;
}

/** The years Prism has any record of, newest first. */
export const taxYears = reviewYears;

/** The year a person most likely means: last year until the April deadline has passed, this year after it. */
export function defaultTaxYear(data: Pick<FinanceData, "transactions" | "today">): number {
  const now = Number(data.today.slice(0, 4));
  const years = reviewYears(data);
  if (Number(data.today.slice(5, 7)) <= 4 && years.includes(now - 1)) return now - 1;
  return years.includes(now) || years.length === 0 ? now : years[0]!;
}

const newestFirst = (a: Transaction, b: Transaction) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? 1 : -1);

/** The summary, its titles and notes in the language of `t`: English for the download and connected apps, the page's own on screen. */
export function taxSummary(data: Pick<FinanceData, "transactions" | "today">, year: number, t: T = EN): TaxSummary {
  const { from, to, partial, recordsFrom } = yearSpan(data, year);
  const inSpan = data.transactions.filter((x) => x.date >= from && x.date <= to);
  const lines = new Map<TaxSectionId, Transaction[]>(TAX_SECTIONS.map((s) => [s.id, []]));
  const political: Transaction[] = [];

  for (const x of inSpan) {
    if (x.pending) continue;
    if (x.category === "income") {
      if (x.amount > 0) lines.get(IN_SECTION[incomeKind(x)])!.push(x);
      continue;
    }
    const found = outSection(x);
    if (!found) continue;
    if ("political" in found) {
      if (x.amount < 0) political.push(x);
      continue;
    }
    // Money back counts only where it can come back, and only as the same kind of spending.
    if (x.amount < 0 || (x.amount > 0 && REFUNDABLE.has(found.id) && isSpendCategory(x.category))) lines.get(found.id)!.push(x);
  }

  const sections: TaxSection[] = [];
  const nothing: TaxSummary["nothing"] = [];
  for (const spec of TAX_SECTIONS) {
    const found = lines.get(spec.id)!.sort(newestFirst);
    const sum = found.reduce((s, x) => s + x.amount, 0);
    const total = spec.side === "in" ? sum : Math.max(0, -sum);
    if (found.length === 0) nothing.push({ id: spec.id, title: t(spec.title) });
    else sections.push({ id: spec.id, side: spec.side, title: t(spec.title), form: spec.form, note: spec.note(year, t), total, lines: found });
  }

  return { year, from, to, partial, recordsFrom, sections, nothing, political: political.sort(newestFirst), transactions: inSpan.length };
}
