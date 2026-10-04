// src/lib/finance/details.ts
//
// What a person adds to one of their own transactions:
//   - a SPLIT across categories (the warehouse run that was groceries AND a
//     lamp), so every chart, budget and total counts each part where it
//     belongs;
//   - TAGS of their own ("Vacation 2026", "Work trip"), to find and total a
//     trip or a project across categories;
//   - who OWES them for it, and how much, until they mark it paid back.
// Kept sealed in their account by transaction id (server/details-actions.ts)
// and applied to their own view only, after their category fixes.
//
// A split becomes its parts: one line per part, each with its own category
// and amount and the id `<id>~<n>`, so the analysis needs no special case.
// What looks for things that repeat (recurring.ts) sees the whole line
// again (wholeLines), so a split bill still forecasts as one bill. A split
// whose parts no longer add up to the bank's amount (a tip added when the
// charge posted) is set aside, never stretched to fit: the line shows whole
// until the person splits it again.

import { CATEGORIES, isSpendCategory } from "./categories";
import { cleanText } from "./p2p";
import type { Cents, ISODate, Owed, SpendCategoryId, Transaction } from "./types";

export type { Owed };
export type SplitPart = { category: SpendCategoryId; amount: Cents };
/** What the person added to one transaction. Split amounts are positive: their sign is the transaction's. */
export type TxnDetail = { split?: SplitPart[]; tags?: string[]; owed?: Owed };
export type TxnDetails = { v: 1; lines: Record<string, TxnDetail> };

export const NO_DETAILS: TxnDetails = { v: 1, lines: {} };

export const DETAIL_LIMITS = {
  /** Transactions with details, at most. */
  lines: 5000,
  parts: 8,
  tags: 6,
  tagLength: 30,
  whoLength: 40,
  /** Tags a person can have across everything, so the list stays one they can scan. */
  allTags: 60,
} as const;

const TXN_ID_MAX = 200;
const SPLIT_MARK = "~";

/** A tag as it's kept: words, no control or direction characters, one space between words. */
export function cleanTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = cleanText(raw, DETAIL_LIMITS.tagLength);
  return t ? t : null;
}

function validParts(x: unknown): SplitPart[] | null {
  if (!Array.isArray(x) || x.length < 2 || x.length > DETAIL_LIMITS.parts) return null;
  const parts: SplitPart[] = [];
  for (const p of x) {
    if (!p || typeof p !== "object") return null;
    const { category, amount } = p as Record<string, unknown>;
    if (typeof category !== "string" || !Object.hasOwn(CATEGORIES, category) || !isSpendCategory(category as SpendCategoryId)) return null;
    if (!Number.isSafeInteger(amount) || (amount as number) <= 0) return null;
    parts.push({ category: category as SpendCategoryId, amount: amount as number });
  }
  return parts;
}

function validTags(x: unknown): string[] | null {
  if (!Array.isArray(x)) return null;
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of x) {
    const t = cleanTag(raw);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    tags.push(t);
    if (tags.length === DETAIL_LIMITS.tags) break;
  }
  return tags.length ? tags : null;
}

function validOwed(x: unknown): Owed | null {
  if (!x || typeof x !== "object") return null;
  const { who, amount, paid } = x as Record<string, unknown>;
  const name = typeof who === "string" ? cleanText(who, DETAIL_LIMITS.whoLength) : "";
  if (!name || !Number.isSafeInteger(amount) || (amount as number) <= 0) return null;
  if (paid !== null && (typeof paid !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(paid))) return null;
  return { who: name, amount: amount as number, paid: paid as ISODate | null };
}

/** One transaction's details, as stored: only what's valid on its own, or null when nothing is. */
export function validDetail(x: unknown): TxnDetail | null {
  if (!x || typeof x !== "object") return null;
  const d = x as Record<string, unknown>;
  const split = d.split === undefined ? null : validParts(d.split);
  const tags = d.tags === undefined ? null : validTags(d.tags);
  const owed = d.owed === undefined ? null : validOwed(d.owed);
  if (!split && !tags && !owed) return null;
  return { ...(split ? { split } : {}), ...(tags ? { tags } : {}), ...(owed ? { owed } : {}) };
}

/** Everything stored, as it was kept: anything unreadable is dropped, never guessed at. */
export function validDetails(x: unknown): TxnDetails {
  if (!x || typeof x !== "object" || (x as { v?: unknown }).v !== 1) return NO_DETAILS;
  const raw = (x as { lines?: unknown }).lines;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NO_DETAILS;
  const kept: [string, TxnDetail][] = [];
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || id.length > TXN_ID_MAX || id.includes(SPLIT_MARK)) continue;
    const d = validDetail(value);
    if (d) kept.push([id, d]);
    if (kept.length === DETAIL_LIMITS.lines) break;
  }
  return { v: 1, lines: Object.fromEntries(kept) };
}

/**
 * A change the person asked for, checked against the transaction it names
 * (their own, whole): a split must be money out, its parts must add up to
 * exactly what the bank says, and what's owed can't be more than was paid.
 * Null keeps nothing for that transaction (the person cleared it).
 */
export function checkDetail(t: Pick<Transaction, "amount" | "category">, x: unknown): { detail: TxnDetail | null } | { error: string } {
  if (!x || typeof x !== "object") return { error: "That didn't come through. Try again." };
  const d = x as Record<string, unknown>;
  const total = Math.abs(t.amount);
  let split: SplitPart[] | null = null;
  if (d.split !== undefined && d.split !== null) {
    if (t.amount >= 0 || t.category === "income") return { error: "Only money going out can be split." };
    split = validParts(d.split);
    if (!split) return { error: `Split it into 2 to ${DETAIL_LIMITS.parts} parts, each with a category and an amount.` };
    const sum = split.reduce((s, p) => s + p.amount, 0);
    if (sum !== total) return { error: `The parts add up to ${dollars(sum)}; they need to add up to ${dollars(total)}.` };
  }
  const tags = d.tags === undefined || d.tags === null ? null : validTags(d.tags);
  let owed: Owed | null = null;
  if (d.owed !== undefined && d.owed !== null) {
    owed = validOwed(d.owed);
    if (!owed) return { error: "Say who owes you, and how much." };
    if (t.amount >= 0) return { error: "Only money you paid out can be owed back." };
    if (owed.amount > total) return { error: `They can owe you at most ${dollars(total)}, what this cost.` };
  }
  if (!split && !tags && !owed) return { detail: null };
  return { detail: { ...(split ? { split } : {}), ...(tags ? { tags } : {}), ...(owed ? { owed } : {}) } };
}

const dollars = (c: Cents) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The details with one transaction's set (or cleared, with null). */
export function withDetail(old: TxnDetails, id: string, detail: TxnDetail | null): TxnDetails {
  const lines = { ...old.lines };
  if (detail) lines[id] = detail;
  else delete lines[id];
  return validDetails({ v: 1, lines });
}

/** Each transaction with what the person added: a split becomes its parts. Never changes the transactions it's given. */
export function applyDetails<T extends Transaction>(txns: T[], details: TxnDetails): T[] {
  if (!Object.keys(details.lines).length) return txns;
  const out: T[] = [];
  for (const t of txns) {
    const d = Object.hasOwn(details.lines, t.id) ? details.lines[t.id]! : null;
    if (!d) {
      out.push(t);
      continue;
    }
    const base: T = { ...t, ...(d.tags ? { tags: d.tags } : {}), ...(d.owed ? { owed: d.owed } : {}) };
    const parts = d.split && t.amount < 0 && d.split.reduce((s, p) => s + p.amount, 0) === -t.amount ? d.split : null;
    if (!parts) {
      out.push(base);
      continue;
    }
    // What the bank said, so a part the person moved says so, and a part that kept it keeps the bank's tax category.
    const bank = t.bankCategory ?? t.category;
    parts.forEach((p, i) => {
      const part: T = {
        ...base,
        id: `${t.id}${SPLIT_MARK}${i + 1}`,
        amount: -p.amount,
        category: p.category,
        split: { of: t.id, part: i + 1, parts: parts.length, total: t.amount },
      };
      if (p.category === bank) delete part.bankCategory;
      else part.bankCategory = bank;
      // What's owed belongs to the whole line: counted once, on its first part.
      if (i > 0) delete part.owed;
      out.push(part);
    });
  }
  return out;
}

/** The lines as the bank sent them: a split's parts joined back into one, in the category of its largest part. */
export function wholeLines<T extends Transaction>(txns: T[]): T[] {
  if (!txns.some((t) => t.split)) return txns;
  const out: T[] = [];
  const wholes = new Map<string, { line: T; biggest: Cents; bank: Transaction["category"] }>();
  for (const t of txns) {
    if (!t.split) {
      out.push(t);
      continue;
    }
    const seen = wholes.get(t.split.of);
    if (!seen) {
      const line: T = { ...t, id: t.split.of, amount: t.split.total };
      delete line.split;
      wholes.set(t.split.of, { line, biggest: Math.abs(t.amount), bank: t.bankCategory ?? t.category });
      out.push(line);
    } else if (Math.abs(t.amount) > seen.biggest) {
      seen.biggest = Math.abs(t.amount);
      seen.line.category = t.category;
    }
  }
  for (const { line, bank } of wholes.values()) {
    if (line.category === bank) delete line.bankCategory;
    else line.bankCategory = bank;
  }
  return out;
}

/** Who owes the person what, still open, oldest first: each with the line it's for. */
export function stillOwed(txns: Transaction[]): { t: Transaction; owed: Owed }[] {
  return txns
    .filter((t): t is Transaction & { owed: Owed } => t.owed !== undefined && t.owed.paid === null)
    .map((t) => ({ t, owed: t.owed }))
    .sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : 0));
}

/** Every tag with what was spent under it and how many lines carry it, the most spent first. */
export function tagTotals(txns: Transaction[]): { tag: string; spent: Cents; count: number }[] {
  const by = new Map<string, { tag: string; spent: Cents; lines: Set<string> }>();
  for (const t of txns) {
    for (const tag of t.tags ?? []) {
      const key = tag.toLowerCase();
      const row = by.get(key) ?? { tag, spent: 0, lines: new Set<string>() };
      row.spent -= t.amount;
      // A split line is one line, however many parts it has.
      row.lines.add(t.split?.of ?? t.id);
      by.set(key, row);
    }
  }
  return [...by.values()].map(({ tag, spent, lines }) => ({ tag, spent, count: lines.size })).sort((a, b) => b.spent - a.spent || a.tag.localeCompare(b.tag));
}
