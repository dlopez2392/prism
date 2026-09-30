// src/lib/finance/import.ts
//
// History from Mint, Monarch or any spreadsheet, as a CSV file. The file is
// read in the person's own browser and never uploaded: only the rows it maps
// travel to the server, in bounded batches, and the server checks every row
// again (validImportRow) rather than trusting the browser. Pure, so the page
// and the server read the same rules.
//
// Money is integer cents, signed like every transaction in Prism: money out
// is negative.

import { CATEGORIES } from "./categories";
import type { AccountKind, Cents, CategoryId, ISODate } from "./types";

export const IMPORT_LIMITS = {
  /** A file bigger than this isn't a transaction export. */
  fileBytes: 20 * 1024 * 1024,
  /** Rows in one import: decades of history for one household. */
  rows: 100_000,
  /** Rows the browser sends at a time, each batch checked and sealed on its own. */
  batch: 2_000,
  merchant: 120,
  account: 80,
  /** Nothing from before this is history anyone needs, and it's usually a bad date. */
  oldest: "1990-01-01",
  /** An import is spread over at most this many stored parts. */
  parts: 60,
  /** Imports one person keeps at once. */
  imports: 20,
} as const;

/** The kinds an imported account can be; anything richer comes from a real connection. */
export const IMPORT_KINDS = ["checking", "savings", "credit", "loan"] as const satisfies readonly AccountKind[];
export type ImportKind = (typeof IMPORT_KINDS)[number];

export type ImportSource = "mint" | "monarch" | "csv";

/** One transaction as the browser maps it and the server stores it. */
export type ImportRow = { date: ISODate; amount: Cents; merchant: string; category: CategoryId };

// ── Reading the file ──────────────────────────────────────────────────────────

/**
 * RFC 4180 CSV: fields may be quoted, quotes inside are doubled, and a
 * quoted field may hold commas and line breaks. A byte-order mark is
 * dropped, and blank lines are skipped. Stops after `maxRows` rows.
 */
export function parseCsv(text: string, maxRows: number = IMPORT_LIMITS.rows + 1): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endRow = () => {
    row.push(field);
    field = "";
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  for (; i < text.length && rows.length < maxRows; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else field += c;
  }
  if (rows.length < maxRows && (field !== "" || row.length > 0)) endRow();
  return rows;
}

// ── Which column is which ─────────────────────────────────────────────────────

/** Column numbers in the file; null when the file has no such column. */
export type ColumnMap = {
  date: number | null;
  merchant: number | null;
  /** One signed amount column… */
  amount: number | null;
  /** …or money out and money in in two columns. */
  debit: number | null;
  credit: number | null;
  /** Mint writes every amount positive and says "debit" or "credit" beside it. */
  type: number | null;
  category: number | null;
  account: number | null;
  /** In a single amount column, whether money out is written as a negative number. */
  outIsNegative: boolean;
};

const EMPTY: ColumnMap = { date: null, merchant: null, amount: null, debit: null, credit: null, type: null, category: null, account: null, outIsNegative: true };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const find = (header: string[], ...names: string[]) => {
  const h = header.map(norm);
  for (const n of names) {
    const i = h.indexOf(n);
    if (i >= 0) return i;
  }
  return null;
};

/** The file's source, told by its header, and the columns Prism would use. */
export function detectColumns(header: string[]): { source: ImportSource; map: ColumnMap } {
  const h = header.map(norm);
  // Mint: Date, Description, Original Description, Amount, Transaction Type, Category, Account Name, Labels, Notes.
  if (h.includes("transaction type") && h.includes("original description") && h.includes("account name")) {
    return {
      source: "mint",
      map: { ...EMPTY, date: find(header, "date"), merchant: find(header, "description"), amount: find(header, "amount"), type: find(header, "transaction type"), category: find(header, "category"), account: find(header, "account name"), outIsNegative: false },
    };
  }
  // Monarch: Date, Merchant, Category, Account, Original Statement, Notes, Amount, Tags.
  if (h.includes("merchant") && h.includes("original statement") && h.includes("account")) {
    return {
      source: "monarch",
      map: { ...EMPTY, date: find(header, "date"), merchant: find(header, "merchant"), amount: find(header, "amount"), category: find(header, "category"), account: find(header, "account") },
    };
  }
  return {
    source: "csv",
    map: {
      ...EMPTY,
      date: find(header, "date", "transaction date", "posted date", "posting date", "trans. date"),
      merchant: find(header, "description", "merchant", "payee", "name", "memo", "details"),
      amount: find(header, "amount", "transaction amount"),
      debit: find(header, "debit", "withdrawal", "withdrawals", "money out"),
      credit: find(header, "credit", "deposit", "deposits", "money in"),
      category: find(header, "category"),
      account: find(header, "account", "account name"),
    },
  };
}

/** Whether the columns chosen are enough to read a transaction. */
export function mapIsUsable(map: ColumnMap): boolean {
  return map.date !== null && map.merchant !== null && (map.amount !== null || (map.debit !== null && map.credit !== null));
}

// ── Reading one row ───────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** A calendar date from "2024-03-09", "3/9/2024" or "03/09/24" (US order). Null for anything else, or a day that doesn't exist. */
export function parseDate(raw: string): ISODate | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s))) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (match[3]!.length === 2) y += y >= 70 ? 1900 : 2000;
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Cents from "$1,234.56", "-12", "(45.00)" or "12.5". Null for anything that isn't an amount. */
export function parseAmount(raw: string): Cents | null {
  let s = raw.trim().replace(/[$\s]/g, "").replace(/,/g, "");
  if (s === "") return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    sign *= -1;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return Number.isSafeInteger(cents) ? sign * cents : null;
}

/**
 * Words in the source's own category that say which of Prism's it is. Order
 * matters (the first match wins) and words match whole: "air" must not find
 * "hair", "car" not "card", "rent" not "rental car", and "Gas & Electric" is
 * a bill, not fuel.
 */
const CATEGORY_WORDS: [RegExp, CategoryId, "in" | "out" | "any"][] = [
  [/\b(transfer|credit card payment|card payment|loan payment|investments?|brokerage)\b/, "transfer", "any"],
  [/\b(paychecks?|payroll|salary|income|interest|dividends?|refunds?|reimbursements?|bonus|deposits?)\b/, "income", "in"],
  [/\b(gas & electric|electric|utilities|utility|phone|internet|mobile|cable|water|bills?|subscriptions?|fees?|charges?|taxes|tax|interest)\b/, "bills", "any"],
  [/\b(travel|hotels?|air ?travel|airlines?|airfare|flights?|vacation|lodging|rental car)\b/, "travel", "any"],
  [/\b(mortgage|rent|home|housing|hoa|furnishings|home improvement|lawn|home services)\b/, "housing", "any"],
  [/\b(groceries|grocery|restaurants?|food|dining|coffee shops?|coffee|bars?|fast food|alcohol)\b/, "food", "any"],
  [/\b(gas|fuel|auto|car|parking|transport|transportation|uber|lyft|taxi|public transit|transit|tolls?|ride ?share)\b/, "transport", "any"],
  [/\b(health|medical|doctors?|dentist|pharmacy|fitness|gym|insurance)\b/, "health", "any"],
  [/\b(entertainment|movies?|music|games?|hobbies|sports?|fun|streaming|amusement|television|tv|arts|newspapers|magazines)\b/, "fun", "any"],
  [/\b(shopping|clothing|electronics|gifts?|books|merchandise|personal care|hair)\b/, "shopping", "any"],
];

/** Prism's category for the source's own label, or from the direction of the money when the label says nothing Prism knows. */
export function categoryFrom(label: string, amount: Cents): CategoryId {
  const l = norm(label);
  if (l) {
    for (const [words, id, way] of CATEGORY_WORDS) {
      if (way === "in" && amount < 0) continue;
      if (words.test(l)) return id;
    }
  }
  return amount > 0 ? "income" : "other";
}

export type MappedRow = ImportRow & { account: string };
export type Skipped = { line: number; reason: string };

/** Every row the chosen columns can read, and the ones they can't, with why (line numbers as a spreadsheet shows them). */
export function mapRows(rows: string[][], map: ColumnMap, today: ISODate): { rows: MappedRow[]; skipped: Skipped[] } {
  const out: MappedRow[] = [];
  const skipped: Skipped[] = [];
  const cell = (r: string[], i: number | null) => (i === null ? "" : (r[i] ?? "").trim());
  rows.forEach((r, n) => {
    const line = n + 2;
    const date = parseDate(cell(r, map.date));
    if (!date) return void skipped.push({ line, reason: "no date Prism can read" });
    if (date > today || date < IMPORT_LIMITS.oldest) return void skipped.push({ line, reason: "a date outside the years Prism keeps" });
    let amount: Cents | null;
    if (map.amount !== null) {
      amount = parseAmount(cell(r, map.amount));
      if (amount !== null && map.type !== null) {
        // Mint: every amount positive, the direction beside it.
        const type = norm(cell(r, map.type));
        amount = type === "debit" ? -Math.abs(amount) : type === "credit" ? Math.abs(amount) : null;
      } else if (amount !== null && !map.outIsNegative) amount = -amount;
    } else {
      const out = parseAmount(cell(r, map.debit));
      const inn = parseAmount(cell(r, map.credit));
      amount = out !== null && out !== 0 ? -Math.abs(out) : inn !== null ? Math.abs(inn) : out;
    }
    if (amount === null) return void skipped.push({ line, reason: "no amount Prism can read" });
    if (amount === 0) return void skipped.push({ line, reason: "an amount of zero" });
    const merchant = cell(r, map.merchant).replace(/\s+/g, " ").slice(0, IMPORT_LIMITS.merchant);
    if (!merchant) return void skipped.push({ line, reason: "no description" });
    out.push({
      date,
      amount,
      merchant,
      category: categoryFrom(cell(r, map.category), amount),
      account: cell(r, map.account).slice(0, IMPORT_LIMITS.account) || "Imported account",
    });
  });
  return { rows: out, skipped };
}

// ── What the server accepts ───────────────────────────────────────────────────

const MAX_CENTS = 100_000_000_000; // a billion dollars: no household transaction is bigger

/** A row as the server receives it from the browser: checked field by field, whatever the page claimed. */
export function validImportRow(x: unknown, today: ISODate): x is ImportRow {
  const r = x as Partial<ImportRow> | null;
  return (
    !!r &&
    typeof r === "object" &&
    Object.keys(r).length === 4 &&
    typeof r.date === "string" &&
    parseDate(r.date) === r.date &&
    r.date >= IMPORT_LIMITS.oldest &&
    r.date <= today &&
    Number.isSafeInteger(r.amount) &&
    r.amount !== 0 &&
    Math.abs(r.amount!) <= MAX_CENTS &&
    typeof r.merchant === "string" &&
    r.merchant.trim() === r.merchant &&
    r.merchant.length >= 1 &&
    r.merchant.length <= IMPORT_LIMITS.merchant &&
    !/[\u0000-\u001f\u007f]/.test(r.merchant) &&
    typeof r.category === "string" &&
    Object.hasOwn(CATEGORIES, r.category)
  );
}

/** What an import is, kept sealed with its first part. */
export type ImportMeta = {
  name: string;
  kind: ImportKind;
  /** A linked account this is older history of, or null for an account of its own (a closed one, say). */
  attachTo: string | null;
  source: ImportSource;
  /** How many stored parts the import has, so a half-finished one is never shown. */
  parts: number;
};

export function validImportMeta(x: unknown): x is ImportMeta {
  const m = x as Partial<ImportMeta> | null;
  return (
    !!m &&
    typeof m === "object" &&
    typeof m.name === "string" &&
    m.name.trim() === m.name &&
    m.name.length >= 1 &&
    m.name.length <= IMPORT_LIMITS.account &&
    !/[\u0000-\u001f\u007f]/.test(m.name) &&
    IMPORT_KINDS.includes(m.kind as ImportKind) &&
    (m.attachTo === null || (typeof m.attachTo === "string" && m.attachTo.length >= 1 && m.attachTo.length <= 200)) &&
    (m.source === "mint" || m.source === "monarch" || m.source === "csv") &&
    Number.isInteger(m.parts) &&
    m.parts! >= 1 &&
    m.parts! <= IMPORT_LIMITS.parts
  );
}

// ── What is kept, and putting it back together ────────────────────────────────

/** The account an import that isn't older history of a linked one shows as. */
export const importAccountId = (importId: string) => `import-${importId}`;

/** One stored part, as sealed: part 0 also says what the import is. */
export type StoredPart = { v: 1; rows: ImportRow[]; meta?: ImportMeta };

/** An import as Prism shows it: every part present and every row checked. */
export type ImportedHistory = { id: string; meta: ImportMeta; rows: ImportRow[]; importedAt: string };

/**
 * An import some part of which no key opens: sealed under a vault key that has since been retired. It can't be
 * shown, and is never removed for it (the key may only be missing for a moment), but the person is told it's there
 * and can remove it, so it never sits in their account unseen or holds one of their twenty places for good.
 */
export type LockedImport = { id: string; importedAt: string };

/** Rows already stored were checked against the day they arrived; opening them again only checks their shape. */
const ANY_DAY = "9999-12-31";

/** An unfinished import older than this was abandoned (a closed tab), and goes. */
export const UNFINISHED_MS = 24 * 60 * 60_000;

/**
 * The person's imports from their opened parts: only those with part 0 and
 * every part it counts, each checked again. Also the ids of imports left
 * unfinished for over a day, to be removed, and the imports that won't open.
 */
export function assembleImports(
  parts: { importId: string; part: number; opened: unknown; createdAt: string }[],
  now = Date.now(),
): { imports: ImportedHistory[]; abandoned: string[]; locked: LockedImport[] } {
  const byImport = new Map<string, typeof parts>();
  for (const p of parts) byImport.set(p.importId, [...(byImport.get(p.importId) ?? []), p]);
  const imports: ImportedHistory[] = [];
  const abandoned: string[] = [];
  const locked: LockedImport[] = [];
  for (const [id, list] of byImport) {
    const opened = new Map(list.map((p) => [p.part, p.opened as Partial<StoredPart> | null]));
    const head = opened.get(0);
    const meta = head && validImportMeta(head.meta) ? head.meta : null;
    const complete = meta !== null && Array.from({ length: meta.parts }, (_, n) => opened.get(n)).every((p) => p && p.v === 1 && Array.isArray(p.rows));
    if (!complete) {
      // Only an import with parts MISSING was abandoned. One whose parts won't open (a key that's gone, or missing
      // from this deployment for a moment) is unreadable, not unfinished, and is never removed for it.
      const readable = list.every((p) => p.opened !== null);
      const oldest = Math.min(...list.map((p) => Date.parse(p.createdAt)));
      if (!readable) locked.push({ id, importedAt: new Date(oldest).toISOString() });
      else if (now - oldest > UNFINISHED_MS) abandoned.push(id);
      continue;
    }
    const rows = Array.from({ length: meta.parts }, (_, n) => opened.get(n)!.rows!).flat().filter((r) => validImportRow(r, ANY_DAY));
    imports.push({ id, meta, rows, importedAt: list.find((p) => p.part === 0)!.createdAt });
  }
  const byDate = (a: { id: string; importedAt: string }, b: { id: string; importedAt: string }) =>
    a.importedAt < b.importedAt ? -1 : a.importedAt > b.importedAt ? 1 : a.id.localeCompare(b.id);
  imports.sort(byDate);
  locked.sort(byDate);
  return { imports, abandoned, locked };
}

/** What Connections lists of an import: never its rows. */
export type ImportSummary = { id: string; name: string; attachTo: string | null; rows: number; from: ISODate; to: ISODate; importedAt: string };

export function summarize(imp: ImportedHistory): ImportSummary {
  let from = imp.rows[0]?.date ?? "";
  let to = from;
  for (const r of imp.rows) {
    if (r.date < from) from = r.date;
    if (r.date > to) to = r.date;
  }
  return { id: imp.id, name: imp.meta.name, attachTo: imp.meta.attachTo, rows: imp.rows.length, from, to, importedAt: imp.importedAt };
}
