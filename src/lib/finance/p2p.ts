// src/lib/finance/p2p.ts
//
// Who a Venmo, PayPal or Cash App payment was really for. None of the three
// lets another app read an account, so a bank shows only "Venmo −$45.00". Each
// lets a person download their own activity as a CSV file: Prism reads that
// file in the person's browser, never uploads it, and matches each payment to
// the bank line it caused, by app, amount and a few days' posting lag. Only
// what matched travels to the server: the bank transaction's id with the
// payment's name and note, which the server checks again against the person's
// own transactions (validP2pMatch) before sealing them into their account.
//
// The names and notes are written by OTHER people (a friend types the note on
// a payment request), so they are cleaned of anything that could change how
// text displays, and kept short. They are data wherever they go, never
// instructions — the MCP server says so to connected apps.
//
// Pure, so the page and the server read the same rules.

import { addDays, daysBetween } from "./dates";
import { parseAmount, parseCsv, parseDate } from "./import";
import type { Cents, ISODate, P2pApp, P2pDirection, P2pNote, Transaction } from "./types";

export const P2P_APPS = ["venmo", "paypal", "cashapp"] as const satisfies readonly P2pApp[];
export type { P2pApp, P2pDirection };
export const P2P_APP_NAMES: Record<P2pApp, string> = { venmo: "Venmo", paypal: "PayPal", cashapp: "Cash App" };

export const P2P_LIMITS = {
  /** A year of activity is well under a megabyte; anything this big isn't one of these files. */
  fileBytes: 10 * 1024 * 1024,
  rows: 20_000,
  name: 80,
  note: 200,
  /** Notes one person keeps; past this, the oldest go first. */
  notes: 3_000,
  /** A bank posts a payment up to this many days after the app records it… */
  lagAfter: 5,
  /** …and, across time zones (Venmo writes UTC), up to a day before. */
  lagBefore: 1,
} as const;

export type { P2pNote };

/** One payment from the app's own file, from the person's side: money they sent is negative. */
export type P2pRow = {
  app: P2pApp;
  date: ISODate;
  amount: Cents;
  dir: P2pDirection;
  name: string;
  note: string | null;
  /** What the bank would show for it, when it reaches the bank at all; empty when it stayed in the app's balance. */
  bank: Cents[];
};

export type P2pFile = { app: P2pApp; rows: P2pRow[]; skipped: number };

// ── Cleaning what other people wrote ─────────────────────────────────────────

/** Control characters, line and paragraph separators, and the invisible marks that reorder or hide text (an emoji's joiner stays). */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b\u200c\u200e\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;

/** Text another person wrote, safe to show and store: one line, no invisible marks, at most `max` characters. */
export function cleanText(raw: string, max: number): string {
  const s = raw.normalize("NFKC").replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  return [...s].slice(0, max).join("").trim();
}

// ── Which app a bank line came from ──────────────────────────────────────────

/** The app behind a bank line, from its merchant: "VENMO *ALEX", "PAYPAL INST XFER", "Cash App*Alex". */
export function appOf(merchant: string): P2pApp | null {
  // The name must end there: "Venmont Diner" isn't Venmo, though "VENMO*ALEX" and "VENMO 1234" are.
  if (/\bvenmo(?![a-z])/i.test(merchant)) return "venmo";
  if (/\bpay\s?pal(?![a-z])|\bpypl(?![a-z])/i.test(merchant)) return "paypal";
  if (/\bcash\s?app(?![a-z])|\bsquare\s?cash(?![a-z])|\bsq\s?\*\s?cash(?![a-z])/i.test(merchant)) return "cashapp";
  return null;
}

// ── Reading each app's file ──────────────────────────────────────────────────

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The first row (of the first 30) holding every one of `needles` as a cell: a file's header. */
export function headerAt(rows: string[][], ...needles: string[]): number {
  return rows.findIndex((r, i) => i < 30 && needles.every((n) => r.some((c) => norm(c) === n)));
}

/** A header's column finder: the first of several names it goes by. */
export function columns(header: string[]) {
  const names = header.map(norm);
  return (...want: string[]) => {
    for (const w of want) {
      const i = names.indexOf(w);
      if (i >= 0) return i;
    }
    return -1;
  };
}

export const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "") : "");
const unique = (xs: Cents[]) => [...new Set(xs.filter((x) => x !== 0))];

/** The account holder in a Venmo file: the name on one side of nearly every payment. */
function selfName(rows: string[][], from: number, to: number): string {
  const seen = new Map<string, number>();
  for (const r of rows) for (const n of [cell(r, from), cell(r, to)]) if (n.trim()) seen.set(n.trim(), (seen.get(n.trim()) ?? 0) + 1);
  let best = "";
  let most = 0;
  for (const [n, c] of seen) if (c > most) [best, most] = [n, c];
  return best;
}

function venmo(rows: string[][], at: number): P2pFile {
  const col = columns(rows[at]!);
  const [dt, type, status, note, from, to, total, fee, funding, destination] = [
    col("datetime"),
    col("type"),
    col("status"),
    col("note"),
    col("from"),
    col("to"),
    col("amount (total)"),
    col("amount (fee)"),
    col("funding source"),
    col("destination"),
  ];
  const body = rows.slice(at + 1);
  const self = selfName(body, from, to);
  const out: P2pRow[] = [];
  let skipped = 0;
  for (const r of body) {
    const date = parseDate(cell(r, dt));
    const amount = parseAmount(cell(r, total));
    // Balance and summary lines carry no date; a payment still pending or cancelled never moved money.
    if (!date || amount === null || amount === 0 || !/complete|issued/i.test(cell(r, status))) {
      skipped++;
      continue;
    }
    const t = cell(r, type);
    if (/transfer/i.test(t)) {
      const feeAbs = Math.abs(parseAmount(cell(r, fee)) ?? 0);
      // Out of Venmo into the bank arrives positive, less any instant-transfer fee; money added from the bank leaves it negative.
      const bank = amount < 0 ? unique([-amount, -amount - feeAbs]) : unique([-amount]);
      out.push({ app: "venmo", date, amount, dir: "transfer", name: amount < 0 ? "Moved to your bank" : "Added from your bank", note: null, bank });
      continue;
    }
    const f = cell(r, from).trim();
    const tt = cell(r, to).trim();
    const other = f === self ? tt : tt === self ? f : amount < 0 ? tt : f;
    // Sent: the bank sees it only when a bank or card paid. Received: only when it went straight to the bank.
    const via = amount < 0 ? cell(r, funding) : cell(r, destination);
    const inApp = !via.trim() || /venmo balance/i.test(via);
    out.push({
      app: "venmo",
      date,
      amount,
      dir: amount < 0 ? "to" : "from",
      name: cleanText(other || "Someone on Venmo", P2P_LIMITS.name),
      note: cleanText(cell(r, note), P2P_LIMITS.note) || null,
      bank: inApp ? [] : [amount],
    });
  }
  return { app: "venmo", rows: out, skipped };
}

function cashApp(rows: string[][], at: number): P2pFile {
  const col = columns(rows[at]!);
  const [dt, type, currency, amt, net, status, notes, who, account] = [
    col("date"),
    col("transaction type"),
    col("currency"),
    col("amount"),
    col("net amount"),
    col("status"),
    col("notes"),
    col("name of sender/receiver"),
    col("account"),
  ];
  const out: P2pRow[] = [];
  let skipped = 0;
  for (const r of rows.slice(at + 1)) {
    const date = parseDate(cell(r, dt));
    const amount = parseAmount(cell(r, amt));
    const cur = cell(r, currency).trim();
    if (!date || amount === null || amount === 0 || (cur && cur.toUpperCase() !== "USD") || /cancel|fail|declin|waiting|pending|refused|expired/i.test(cell(r, status))) {
      skipped++;
      continue;
    }
    const t = cell(r, type);
    const netAbs = Math.abs(parseAmount(cell(r, net)) ?? amount);
    if (/cash\s?out|withdraw/i.test(t)) {
      out.push({ app: "cashapp", date, amount, dir: "transfer", name: "Moved to your bank", note: null, bank: unique([Math.abs(amount), netAbs]) });
      continue;
    }
    if (/cash\s?in|add(ed)?\s?cash/i.test(t)) {
      out.push({ app: "cashapp", date, amount, dir: "transfer", name: "Added from your bank", note: null, bank: unique([-Math.abs(amount)]) });
      continue;
    }
    // Card purchases, Bitcoin, stocks and boosts aren't payments between people.
    if (!/p2p|payment|request|sent|received/i.test(t)) {
      skipped++;
      continue;
    }
    const acct = cell(r, account);
    const fromBank = /debit|credit|visa|master|amex|discover|bank|checking|savings/i.test(acct) && !/cash card/i.test(acct);
    out.push({
      app: "cashapp",
      date,
      amount,
      dir: amount < 0 ? "to" : "from",
      name: cleanText(cell(r, who) || "Someone on Cash App", P2P_LIMITS.name),
      note: cleanText(cell(r, notes), P2P_LIMITS.note) || null,
      bank: fromBank ? [amount] : [],
    });
  }
  return { app: "cashapp", rows: out, skipped };
}

function payPal(rows: string[][], at: number): P2pFile {
  const col = columns(rows[at]!);
  const [dt, name, type, status, currency, gross, net, noteCol] = [
    col("date"),
    col("name"),
    col("type"),
    col("status"),
    col("currency"),
    col("gross", "amount"),
    col("net"),
    col("note", "subject", "item title"),
  ];
  const out: P2pRow[] = [];
  let skipped = 0;
  for (const r of rows.slice(at + 1)) {
    const date = parseDate(cell(r, dt));
    const amount = parseAmount(cell(r, gross));
    const cur = cell(r, currency).trim();
    if (!date || amount === null || amount === 0 || (cur && cur.toUpperCase() !== "USD") || !/completed/i.test(cell(r, status))) {
      skipped++;
      continue;
    }
    const t = cell(r, type);
    // The bank or card topping PayPal up for a payment: the payment's own line says who it was for.
    if (/deposit to pp|card deposit|transfer from bank|bank deposit|add funds|hold|authorization/i.test(t)) {
      skipped++;
      continue;
    }
    if (/withdraw|transfer to bank|standard transfer|instant transfer/i.test(t)) {
      const netAbs = Math.abs(parseAmount(cell(r, net)) ?? amount);
      out.push({ app: "paypal", date, amount, dir: "transfer", name: "Moved to your bank", note: null, bank: unique([Math.abs(amount), netAbs]) });
      continue;
    }
    const who = cleanText(cell(r, name), P2P_LIMITS.name);
    if (!who) {
      skipped++;
      continue;
    }
    out.push({
      app: "paypal",
      date,
      amount,
      dir: amount < 0 ? "to" : "from",
      name: who,
      note: cleanText(cell(r, noteCol), P2P_LIMITS.note) || null,
      // Money received stays in the PayPal balance until it's moved; money sent reaches the bank or card that paid.
      bank: amount < 0 ? [amount] : [],
    });
  }
  return { app: "paypal", rows: out, skipped };
}

/** Which app wrote this file, and its payments; null for a file that isn't one of the three. */
export function readP2pFile(text: string): P2pFile | null {
  const rows = parseCsv(text, P2P_LIMITS.rows + 40);
  let at = headerAt(rows, "datetime", "amount (total)");
  if (at >= 0) return venmo(rows, at);
  at = headerAt(rows, "transaction type", "name of sender/receiver");
  if (at >= 0) return cashApp(rows, at);
  at = headerAt(rows, "timezone", "name", "type", "status");
  if (at >= 0 && rows[at]!.some((c) => ["gross", "amount"].includes(norm(c)))) return payPal(rows, at);
  return null;
}

/**
 * Rows from several files, where the same payment in two overlapping files
 * (two quarterly statements that share a month) counts once. Two identical
 * payments in ONE file are two payments, and stay two.
 */
export function combineP2pFiles(files: P2pRow[][]): P2pRow[] {
  const most = new Map<string, { row: P2pRow; n: number }>();
  for (const rows of files) {
    const here = new Map<string, number>();
    for (const r of rows) {
      const key = JSON.stringify([r.app, r.date, r.amount, r.dir, r.name, r.note]);
      const n = (here.get(key) ?? 0) + 1;
      here.set(key, n);
      if (n > (most.get(key)?.n ?? 0)) most.set(key, { row: r, n });
    }
  }
  return [...most.values()].flatMap(({ row, n }) => Array.from({ length: n }, () => row));
}

// ── Matching payments to the bank ────────────────────────────────────────────

export type BankLine = Pick<Transaction, "id" | "date" | "amount" | "merchant">;
export type P2pMatch = P2pNote & { txnId: string; amount: Cents; bankDate: ISODate };

export type P2pResult = {
  matches: P2pMatch[];
  /** Payments that stayed in the app's balance: the bank never saw them. */
  inApp: number;
  /** Payments that should have reached a bank Prism can see, but no line matched. */
  unmatched: number;
  /** The span the file covers. */
  from: ISODate | null;
  to: ISODate | null;
};

/**
 * Each payment to at most one bank line and each line to at most one payment:
 * same app, an amount the bank would show for it, and the line dated from a
 * day before to five days after. Closest dates pair first, so two identical
 * payments a week apart can't swap.
 */
export function matchP2p(rows: P2pRow[], lines: BankLine[]): P2pResult {
  const candidates = lines.map((l) => ({ line: l, app: appOf(l.merchant) })).filter((c): c is { line: BankLine; app: P2pApp } => c.app !== null);
  const pairs: { row: number; line: number; gap: number }[] = [];
  rows.forEach((r, ri) => {
    if (!r.bank.length) return;
    const earliest = addDays(r.date, -P2P_LIMITS.lagBefore);
    const latest = addDays(r.date, P2P_LIMITS.lagAfter);
    candidates.forEach((c, li) => {
      if (c.app !== r.app || !r.bank.includes(c.line.amount) || c.line.date < earliest || c.line.date > latest) return;
      pairs.push({ row: ri, line: li, gap: Math.abs(daysBetween(r.date, c.line.date)) });
    });
  });
  pairs.sort((a, b) => a.gap - b.gap || (rows[a.row]!.date < rows[b.row]!.date ? -1 : rows[a.row]!.date > rows[b.row]!.date ? 1 : 0) || a.row - b.row || (candidates[a.line]!.line.id < candidates[b.line]!.line.id ? -1 : 1));
  const rowUsed = new Set<number>();
  const lineUsed = new Set<number>();
  const matches: P2pMatch[] = [];
  for (const p of pairs) {
    if (rowUsed.has(p.row) || lineUsed.has(p.line)) continue;
    rowUsed.add(p.row);
    lineUsed.add(p.line);
    const r = rows[p.row]!;
    const l = candidates[p.line]!.line;
    matches.push({ app: r.app, dir: r.dir, name: r.name, note: r.note, date: r.date, txnId: l.id, amount: l.amount, bankDate: l.date });
  }
  const dates = rows.map((r) => r.date).sort();
  return {
    matches: matches.sort((a, b) => (a.bankDate < b.bankDate ? 1 : a.bankDate > b.bankDate ? -1 : 0)),
    inApp: rows.filter((r) => !r.bank.length).length,
    unmatched: rows.filter((r, i) => r.bank.length && !rowUsed.has(i)).length,
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
  };
}

// ── What's kept, and checked again on the server ─────────────────────────────

export type P2pNotes = { v: 1; notes: Record<string, P2pNote> };
export const NO_P2P_NOTES: P2pNotes = { v: 1, notes: {} };
const TXN_ID_MAX = 200;

function validNote(x: unknown): P2pNote | null {
  if (!x || typeof x !== "object") return null;
  const n = x as Record<string, unknown>;
  if (!P2P_APPS.includes(n.app as P2pApp) || !["to", "from", "transfer"].includes(n.dir as string)) return null;
  if (typeof n.name !== "string" || typeof n.date !== "string" || !parseDate(n.date) || parseDate(n.date) !== n.date) return null;
  if (n.note !== null && typeof n.note !== "string") return null;
  const name = cleanText(n.name, P2P_LIMITS.name);
  if (!name) return null;
  const note = typeof n.note === "string" ? cleanText(n.note, P2P_LIMITS.note) || null : null;
  return { app: n.app as P2pApp, dir: n.dir as P2pDirection, name, note, date: n.date };
}

/** Kept notes, read back as untrusted input: a bad entry is dropped on its own, and the newest are kept past the limit. */
export function validP2pNotes(x: unknown): P2pNotes {
  if (!x || typeof x !== "object" || (x as { v?: unknown }).v !== 1) return NO_P2P_NOTES;
  const raw = (x as { notes?: unknown }).notes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NO_P2P_NOTES;
  const kept: [string, P2pNote][] = [];
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const note = validNote(value);
    if (note && id.length > 0 && id.length <= TXN_ID_MAX) kept.push([id, note]);
  }
  kept.sort((a, b) => (a[1].date < b[1].date ? 1 : a[1].date > b[1].date ? -1 : 0));
  return { v: 1, notes: Object.fromEntries(kept.slice(0, P2P_LIMITS.notes)) };
}

/**
 * A match from the browser, checked against the person's own transaction: it
 * must exist, come from the app named, and the payment's date must sit in
 * the posting window before it. The note it returns is cleaned again.
 */
export function validP2pMatch(x: unknown, byId: Map<string, Pick<Transaction, "id" | "date" | "amount" | "merchant">>): [string, P2pNote] | null {
  if (!x || typeof x !== "object") return null;
  const m = x as Record<string, unknown>;
  if (typeof m.txnId !== "string") return null;
  const txn = byId.get(m.txnId);
  const note = validNote(m);
  if (!txn || !note || appOf(txn.merchant) !== note.app) return null;
  if (txn.date < addDays(note.date, -P2P_LIMITS.lagBefore) || txn.date > addDays(note.date, P2P_LIMITS.lagAfter)) return null;
  // Sent shows as money out, received as money in; a transfer can go either way.
  if ((note.dir === "to" && txn.amount >= 0) || (note.dir === "from" && txn.amount <= 0)) return null;
  return [txn.id, note];
}

/** New notes over old, newest kept past the limit. */
export function mergeP2pNotes(old: P2pNotes, added: [string, P2pNote][]): P2pNotes {
  return validP2pNotes({ v: 1, notes: { ...old.notes, ...Object.fromEntries(added) } });
}

/** Each transaction with its note, when it has one. Never changes the transactions it's given. */
export function applyP2pNotes<T extends Transaction>(txns: T[], notes: P2pNotes): T[] {
  if (!Object.keys(notes.notes).length) return txns;
  return txns.map((t) => (Object.hasOwn(notes.notes, t.id) ? { ...t, p2p: notes.notes[t.id]! } : t));
}

/** "To Alex Kim", "From Sam", or "Moved to your bank", as a ledger line reads it. */
export function p2pLabel(n: Pick<P2pNote, "dir" | "name">): string {
  return n.dir === "to" ? `To ${n.name}` : n.dir === "from" ? `From ${n.name}` : n.name;
}
