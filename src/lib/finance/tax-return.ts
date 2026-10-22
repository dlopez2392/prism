// src/lib/finance/tax-return.ts
//
// A person's filed federal return (Form 1040), as the handful of figures
// Prism keeps from it: the tax year, the filing status, and what the return
// says the person earned, owed and paid. The PDF is read in the browser
// (components/return-upload.tsx hands its text here) and never uploaded;
// the person checks the figures before they're saved, sealed with the rest of
// their details. Names, Social Security numbers, addresses, dependents and
// bank details are never read: each figure is found by the words printed
// beside its line on the form, and nothing else on the page is kept.
//
// What it's for (returnFacts): last year's return beside this year's money on
// Taxes. Its effective rate, the refund or the bill, its business income
// beside this year's Schedule C, and the safe-harbor amount: paying at least
// last year's total tax (110% when the return's AGI was over $150,000, or
// $75,000 married filing separately) through withholding and estimated
// payments generally avoids the IRS's underpayment penalty (Form 2210). That
// is the rule, said once; Prism never works out what the person should pay.
//
// Pure: reads text and figures.

import type { Cents } from "./types";
import { msg } from "@/lib/i18n/t";

export type FilingStatus = "single" | "joint" | "separate" | "head" | "widow";
export const FILING_STATUSES: readonly FilingStatus[] = ["single", "joint", "separate", "head", "widow"];

/** The figures Prism keeps, each in cents, null when the return doesn't say (or the person left it blank). */
export const RETURN_FIGURES = ["wages", "business", "totalIncome", "agi", "taxable", "totalTax", "withheld", "estimated", "payments", "refund", "owed"] as const;
export type ReturnFigure = (typeof RETURN_FIGURES)[number];

export type TaxReturn = { year: number; status: FilingStatus | null } & Record<ReturnFigure, Cents | null>;

/** Each figure, and each filing status, as a person reads it (translated where shown). */
export const FIGURE_LABELS: Record<ReturnFigure, string> = {
  wages: msg("Wages"),
  business: msg("Business income or loss"),
  totalIncome: msg("Total income"),
  agi: msg("Adjusted gross income"),
  taxable: msg("Taxable income"),
  totalTax: msg("Total tax"),
  withheld: msg("Tax withheld"),
  estimated: msg("Estimated tax payments"),
  payments: msg("Total payments"),
  refund: msg("Refund"),
  owed: msg("Amount you owed"),
};

export const STATUS_LABELS: Record<FilingStatus, string> = {
  single: msg("Single"),
  joint: msg("Married filing jointly"),
  separate: msg("Married filing separately"),
  head: msg("Head of household"),
  widow: msg("Qualifying surviving spouse"),
};

/** The most of any one figure: $1 billion. */
const FIGURE_MAX: Cents = 100_000_000_000;
/** The most returns kept, a year each. */
export const RETURNS_KEPT = 10;

/** Each figure's line on the 2019 and later Form 1040 (Schedule 1 for business income), as a person looks for it. */
export const RETURN_LINES: Record<ReturnFigure, string> = {
  wages: "1z",
  business: "Schedule 1, 3",
  totalIncome: "9",
  agi: "11",
  taxable: "15",
  totalTax: "24",
  withheld: "25d",
  estimated: "26",
  payments: "33",
  refund: "35a",
  owed: "37",
};

/** A return as stored or as typed: a year, a known status or none, and figures that are whole cents in range. Null when any part doesn't read, or nothing worth keeping is there. */
export function validTaxReturn(x: unknown, thisYear: number): TaxReturn | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (!Number.isSafeInteger(r.year) || (r.year as number) < 2000 || (r.year as number) > thisYear) return null;
  if (r.status !== null && r.status !== undefined && !FILING_STATUSES.includes(r.status as FilingStatus)) return null;
  const out = { year: r.year as number, status: (r.status ?? null) as FilingStatus | null } as TaxReturn;
  for (const k of RETURN_FIGURES) {
    const v = r[k];
    if (v === null || v === undefined) {
      out[k] = null;
      continue;
    }
    // Business income can be a loss; everything else on these lines is zero or more.
    const min = k === "business" ? -FIGURE_MAX : 0;
    if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > FIGURE_MAX) return null;
    out[k] = v as Cents;
  }
  // A return with neither its AGI nor its total tax isn't one to compare against.
  return out.agi === null && out.totalTax === null ? null : out;
}

// — Reading the PDF's text —————————————————————————————————————————————

/** One run of text on a page, where the PDF put it: x from the left, y from the bottom, in points. */
export type PageText = { str: string; x: number; y: number };

type Row = { y: number; items: PageText[]; text: string };

/** Each figure, the words printed on its line (any year since 2019, then the older wording), and the line numbers that sit beside an empty amount and must never be read as one. */
const FINDERS: { key: ReturnFigure; words: RegExp[]; lines: string[] }[] = [
  { key: "wages", words: [/add lines 1a through 1h/, /wages, salaries, tips, etc\.? attach form/], lines: ["1z", "1"] },
  { key: "totalIncome", words: [/this is your total income/], lines: ["9"] },
  { key: "agi", words: [/this is your adjusted gross income/], lines: ["11", "11a", "8b"] },
  { key: "taxable", words: [/this is your taxable income/], lines: ["15", "11b"] },
  { key: "totalTax", words: [/this is your total tax/], lines: ["24", "16"] },
  { key: "withheld", words: [/add lines 25a through 25c/], lines: ["25d"] },
  { key: "estimated", words: [/estimated tax payments and amount applied from/], lines: ["26"] },
  { key: "payments", words: [/these are your total payments/], lines: ["33"] },
  { key: "refund", words: [/amount of line 34 you want refunded to you/], lines: ["35a"] },
  { key: "owed", words: [/this is the amount you owe/, /subtract line 33 from line 24/], lines: ["37"] },
  { key: "business", words: [/business income or \(loss\)\.? attach schedule c/], lines: ["3"] },
];

/** A dollar amount as a return prints it: "85,432", "85,432.", "85,432.00", "(1,200)" or "-1,200". */
const AMOUNT = /^(\(|-)?\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{0,2}))?\)?$/;

function amountOf(s: string): Cents | null {
  const m = AMOUNT.exec(s.trim());
  if (!m) return null;
  const cents = Number(m[2]!.replace(/,/g, "")) * 100 + Number((m[3] ?? "").padEnd(2, "0") || "0");
  return m[1] ? -cents : cents;
}

/** A page's text in rows, top to bottom, each left to right. */
function rowsOf(items: PageText[]): Row[] {
  const rows: Row[] = [];
  for (const it of [...items].filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= 2.5);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it], text: "" });
  }
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    r.text = r.items.map((i) => i.str.trim()).join(" ").replace(/\s+/g, " ").toLowerCase();
  }
  return rows;
}

/** The amount on a line: the rightmost amount right of where its words start, on its row or the row just below (words that wrap). */
function amountOnLine(rows: Row[], i: number, from: number, lines: string[]): Cents | null {
  for (const r of [rows[i], rows[i + 1]]) {
    if (!r || Math.abs(r.y - rows[i]!.y) > 14) continue;
    const amounts = r.items.filter((it) => it.x > from && !lines.includes(it.str.trim().toLowerCase())).map((it) => amountOf(it.str)).filter((v): v is Cents => v !== null);
    if (amounts.length) return amounts[amounts.length - 1]!;
  }
  return null;
}

const STATUS_WORDS: [RegExp, FilingStatus][] = [
  [/^single$/, "single"],
  [/^married filing jointly/, "joint"],
  [/^married filing separately/, "separate"],
  [/^head of household/, "head"],
  [/^qualifying (surviving spouse|widow)/, "widow"],
];
const MARK = /^(x|✓|✔|☒|■)$/i;

/** The box ticked beside a filing status: a mark, and the status words just right of it. */
function statusOf(rows: Row[]): FilingStatus | null {
  for (const r of rows) {
    if (!/single/.test(r.text) || !/married filing/.test(r.text)) continue;
    // The status words may wrap to the row below, so look there too.
    const near = rows.filter((o) => o.y <= r.y && r.y - o.y <= 14);
    for (const row of near) {
      for (const mark of row.items.filter((it) => MARK.test(it.str.trim()))) {
        const next = near
          .flatMap((o) => o.items)
          .filter((it) => it.x > mark.x && it.x - mark.x <= 40 && Math.abs(it.y - mark.y) <= 4 && !MARK.test(it.str.trim()))
          .sort((a, b) => a.x - b.x)[0];
        const hit = next && STATUS_WORDS.find(([re]) => re.test(next.str.trim().toLowerCase()));
        if (hit) return hit[1];
      }
    }
  }
  return null;
}

/** The tax year a return is for, from its own heading. */
function yearOf(pages: Row[][]): number | null {
  for (const rows of pages) {
    const text = rows.map((r) => r.text).join(" ");
    const m =
      /for the year jan\.? 1\s*[–—-]\s*dec\.? 31,? (20\d{2})/.exec(text) ??
      /(20\d{2}) u\.?s\.? individual income tax return/.exec(text) ??
      /u\.?s\.? individual income tax return (20\d{2})/.exec(text) ??
      /form 1040[^0-9]{0,40}(20\d{2})/.exec(text);
    if (m) return Number(m[1]);
  }
  return null;
}

export type ReadReturn = { found: boolean; year: number | null; status: FilingStatus | null; figures: Record<ReturnFigure, Cents | null> };

/**
 * The figures a 1040 in `pages` prints, each found by the words on its line:
 * the first page that has a line wins, so a state return or a worksheet
 * further on never overrides the federal form. `found` says whether this
 * looks like a 1040 at all.
 */
export function readReturn(pages: PageText[][]): ReadReturn {
  const rows = pages.map(rowsOf);
  const figures = Object.fromEntries(RETURN_FIGURES.map((k) => [k, null])) as Record<ReturnFigure, Cents | null>;
  for (const f of FINDERS) {
    search: for (const page of rows) {
      for (let i = 0; i < page.length; i++) {
        if (!f.words.some((w) => w.test(page[i]!.text))) continue;
        // Where the line's words start: the amount sits to the right of them.
        const start = page[i]!.items[0]!.x;
        const v = amountOnLine(page, i, start, f.lines);
        if (v !== null) {
          figures[f.key] = f.key === "business" ? v : Math.abs(v);
          break search;
        }
      }
    }
  }
  const status = rows.map(statusOf).find((s) => s !== null) ?? null;
  const found = figures.agi !== null || figures.totalTax !== null || figures.totalIncome !== null;
  return { found, year: yearOf(rows), status, figures };
}

// — What it says beside this year —————————————————————————————————————

/** AGI over this means 110% for the safe harbor ($75,000 married filing separately). */
const SAFE_HARBOR_HIGH: Cents = 15_000_000;
const SAFE_HARBOR_HIGH_SEPARATE: Cents = 7_500_000;

export type ReturnFacts = {
  /** Total tax ÷ AGI, when both are there and AGI is above zero. */
  effectiveRate: number | null;
  /** What came back (positive) or was owed (negative), when the return says. */
  settled: Cents | null;
  /** The year after this return: paying at least this much in total tax through withholding and estimated payments generally avoids an underpayment penalty. */
  safeHarbor: { amount: Cents; share: 1 | 1.1 } | null;
};

export function returnFacts(r: TaxReturn): ReturnFacts {
  const effectiveRate = r.totalTax !== null && r.agi !== null && r.agi > 0 ? r.totalTax / r.agi : null;
  const settled = r.refund !== null && r.refund > 0 ? r.refund : r.owed !== null && r.owed > 0 ? -r.owed : r.refund === 0 || r.owed === 0 ? 0 : null;
  const high = r.agi !== null && r.agi > (r.status === "separate" ? SAFE_HARBOR_HIGH_SEPARATE : SAFE_HARBOR_HIGH);
  const share = high ? 1.1 : 1;
  const safeHarbor = r.totalTax !== null && r.totalTax > 0 ? { amount: Math.round(r.totalTax * share), share: share as 1 | 1.1 } : null;
  return { effectiveRate, settled, safeHarbor };
}
