// src/lib/finance/orders.ts
//
// What an Amazon charge paid for. A bank shows "AMZN Mktp US -$86.40" and
// nothing more; Amazon lets a person download their own order history
// (Account → Request your data → Your Orders, which arrives as a zip holding
// Retail.OrderHistory.1.csv: one row per item). Prism reads that file in the
// person's browser, never uploads it, and matches each charge to the items it
// paid for. Amazon charges a card as each shipment leaves, so a charge is a
// shipment's items added up (or, where it charged once, the whole order's),
// paired with a line from an Amazon merchant for exactly that amount, dated
// from a day before the shipment to six days after. Only what matched travels
// to the server, which checks again that the items add up to the bank's
// amount, to the cent (validOrderMatch), before sealing them into the
// person's account.
//
// Item names are the seller's words: cleaned of anything that could change
// how text displays, kept short, and data wherever they go, never
// instructions — the MCP server says so to connected apps.
//
// Pure, so the page and the server read the same rules.

import { addDays, daysBetween } from "./dates";
import { parseAmount, parseCsv, parseDate } from "./import";
import { cell, cleanText, columns, headerAt } from "./p2p";
import type { Cents, ISODate, OrderItem, OrderNote, Transaction } from "./types";

export type { OrderItem, OrderNote };

export const ORDER_LIMITS = {
  /** Years of orders, addresses and all, stay well under this; anything bigger isn't the file. */
  fileBytes: 40 * 1024 * 1024,
  rows: 50_000,
  /** An item's name, as kept. */
  name: 100,
  /** Items kept for one charge: past this, the rest are added up as one. */
  items: 20,
  /** Charges kept with their items: past this, the oldest orders go first. */
  notes: 2_000,
  orderId: 40,
  /** Amazon dates a shipment in UTC, and a bank posts a charge up to a few days later. */
  lagBefore: 1,
  lagAfter: 6,
  /** How long after an order its last shipment may leave (a preorder, a back order): the server's outer bound. */
  shipsWithin: 120,
  /** Matches sent to the server at a time, so no request comes near the size a server action takes. */
  batch: 150,
} as const;

/** A bank line from Amazon: "AMAZON.COM*2K4", "AMZN Mktp US*1A2B", "Amazon Fresh" — never "Amazonas Grill". */
export function isAmazon(merchant: string): boolean {
  return /\bamazon(?![a-z])|\bamzn(?![a-z])/i.test(merchant);
}

// ── Reading the file ─────────────────────────────────────────────────────────

/** One item in the file: its order, the day it was ordered and shipped, and what it cost with its share of tax and shipping. */
export type OrderRow = { order: string; date: ISODate; ship: ISODate | null; name: string; qty: number; amount: Cents };
export type OrderFile = { rows: OrderRow[]; skipped: number };

/**
 * Amazon's order history (Retail.OrderHistory.1.csv), or null when the file
 * isn't one. Items in another currency, cancelled, or without an amount are
 * counted as skipped, never guessed at.
 */
export function readAmazonFile(text: string): OrderFile | null {
  const all = parseCsv(text, ORDER_LIMITS.rows + 5);
  const at = headerAt(all, "order id", "order date", "total owed", "product name");
  if (at < 0) return null;
  const col = columns(all[at]!);
  const [id, ordered, owed, product, shipped, quantity, currency, status] = [
    col("order id"),
    col("order date"),
    col("total owed"),
    col("product name"),
    col("ship date"),
    col("quantity"),
    col("currency"),
    col("order status"),
  ];
  const rows: OrderRow[] = [];
  let skipped = 0;
  for (const r of all.slice(at + 1)) {
    if (r.every((c) => !c.trim())) continue;
    const order = cleanText(cell(r, id), ORDER_LIMITS.orderId);
    const date = parseDate(cell(r, ordered));
    const amount = parseAmount(cell(r, owed));
    const money = cell(r, currency).trim().toUpperCase();
    if (!order || !date || amount === null || amount <= 0 || (money && money !== "USD") || /cancel/i.test(cell(r, status))) {
      skipped++;
      continue;
    }
    const qty = Number.parseInt(cell(r, quantity), 10);
    rows.push({
      order,
      date,
      ship: parseDate(cell(r, shipped)),
      name: cleanText(cell(r, product), ORDER_LIMITS.name) || "An Amazon item",
      qty: Number.isSafeInteger(qty) && qty > 0 ? Math.min(qty, 999) : 1,
      amount,
    });
  }
  return { rows, skipped };
}

// ── Matching charges to the bank ─────────────────────────────────────────────

export type BankLine = Pick<Transaction, "id" | "date" | "amount" | "merchant">;
export type OrderMatch = OrderNote & { txnId: string; amount: Cents; bankDate: ISODate };

export type OrderResult = {
  matches: OrderMatch[];
  /** Orders with nothing matched: paid with a gift card or points, charged to a card Prism can't see, or refunded. */
  unmatched: number;
  orders: number;
  from: ISODate | null;
  to: ISODate | null;
};

/** The items a charge paid for, as kept: at most ORDER_LIMITS.items, the rest added up as one, so they always total the charge. */
export function keptItems(rows: Pick<OrderRow, "name" | "qty" | "amount">[]): OrderItem[] {
  const items = rows.map((r) => ({ name: r.name, qty: r.qty, amount: r.amount }));
  if (items.length <= ORDER_LIMITS.items) return items;
  const head = items.slice(0, ORDER_LIMITS.items - 1);
  const rest = items.slice(ORDER_LIMITS.items - 1);
  return [...head, { name: `${rest.length} more items`, qty: rest.reduce((s, x) => s + x.qty, 0), amount: rest.reduce((s, x) => s + x.amount, 0) }];
}

/**
 * Each charge to at most one bank line and each line to at most one charge.
 * A charge is a shipment's items, or the whole order's when it shipped in
 * more than one go and was charged once; the amount must be the bank's to the
 * cent, from an Amazon line dated from a day before the shipment to six days
 * after. Closest dates pair first, shipments before whole orders, and an
 * item is never counted in two charges.
 */
export function matchOrders(rows: OrderRow[], lines: BankLine[]): OrderResult {
  const amazon = lines.filter((l) => l.amount < 0 && isAmazon(l.merchant));
  const byOrder = new Map<string, number[]>();
  rows.forEach((r, i) => byOrder.set(r.order, [...(byOrder.get(r.order) ?? []), i]));
  type Charge = { order: string; rows: number[]; anchor: ISODate; from: ISODate; to: ISODate; amount: Cents; whole: boolean };
  const charges: Charge[] = [];
  for (const [order, idx] of byOrder) {
    const shipments = new Map<ISODate, number[]>();
    for (const i of idx) {
      const day = rows[i]!.ship ?? rows[i]!.date;
      shipments.set(day, [...(shipments.get(day) ?? []), i]);
    }
    const sum = (ix: number[]) => ix.reduce((s, i) => s + rows[i]!.amount, 0);
    for (const [day, ix] of shipments) {
      charges.push({ order, rows: ix, anchor: day, from: addDays(day, -ORDER_LIMITS.lagBefore), to: addDays(day, ORDER_LIMITS.lagAfter), amount: sum(ix), whole: false });
    }
    if (shipments.size > 1) {
      const days = [...shipments.keys()].sort();
      charges.push({ order, rows: idx, anchor: days[0]!, from: addDays(days[0]!, -ORDER_LIMITS.lagBefore), to: addDays(days.at(-1)!, ORDER_LIMITS.lagAfter), amount: sum(idx), whole: true });
    }
  }
  const pairs: { charge: number; line: number; gap: number }[] = [];
  charges.forEach((c, ci) => {
    amazon.forEach((l, li) => {
      if (-l.amount !== c.amount || l.date < c.from || l.date > c.to) return;
      pairs.push({ charge: ci, line: li, gap: Math.abs(daysBetween(c.anchor, l.date)) });
    });
  });
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  pairs.sort(
    (a, b) =>
      a.gap - b.gap ||
      Number(charges[a.charge]!.whole) - Number(charges[b.charge]!.whole) ||
      cmp(charges[a.charge]!.anchor, charges[b.charge]!.anchor) ||
      a.charge - b.charge ||
      cmp(amazon[a.line]!.id, amazon[b.line]!.id),
  );
  const rowUsed = new Set<number>();
  const lineUsed = new Set<number>();
  const matches: OrderMatch[] = [];
  for (const p of pairs) {
    const c = charges[p.charge]!;
    if (lineUsed.has(p.line) || c.rows.some((i) => rowUsed.has(i))) continue;
    for (const i of c.rows) rowUsed.add(i);
    lineUsed.add(p.line);
    const l = amazon[p.line]!;
    const first = rows[c.rows[0]!]!;
    matches.push({ order: c.order, date: first.date, items: keptItems(c.rows.map((i) => rows[i]!)), txnId: l.id, amount: l.amount, bankDate: l.date });
  }
  const dates = rows.map((r) => r.date).sort();
  return {
    matches: matches.sort((a, b) => cmp(b.bankDate, a.bankDate)),
    unmatched: [...byOrder.values()].filter((idx) => !idx.some((i) => rowUsed.has(i))).length,
    orders: byOrder.size,
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
  };
}

// ── What's kept, and checked again on the server ─────────────────────────────

export type OrderNotes = { v: 1; notes: Record<string, OrderNote> };
export const NO_ORDER_NOTES: OrderNotes = { v: 1, notes: {} };
const TXN_ID_MAX = 200;

function validItem(x: unknown): OrderItem | null {
  if (!x || typeof x !== "object") return null;
  const { name, qty, amount } = x as Record<string, unknown>;
  const label = typeof name === "string" ? cleanText(name, ORDER_LIMITS.name) : "";
  if (!label || !Number.isSafeInteger(qty) || (qty as number) < 1 || (qty as number) > 999) return null;
  if (!Number.isSafeInteger(amount) || (amount as number) <= 0) return null;
  return { name: label, qty: qty as number, amount: amount as number };
}

function validNote(x: unknown): OrderNote | null {
  if (!x || typeof x !== "object") return null;
  const n = x as Record<string, unknown>;
  const order = typeof n.order === "string" ? cleanText(n.order, ORDER_LIMITS.orderId) : "";
  if (!order || typeof n.date !== "string" || parseDate(n.date) !== n.date) return null;
  if (!Array.isArray(n.items) || n.items.length < 1 || n.items.length > ORDER_LIMITS.items) return null;
  const items = n.items.map(validItem);
  if (items.some((i) => i === null)) return null;
  return { order, date: n.date, items: items as OrderItem[] };
}

/** Kept notes, read back as untrusted input: a bad entry is dropped on its own, and the newest orders are kept past the limit. */
export function validOrderNotes(x: unknown): OrderNotes {
  if (!x || typeof x !== "object" || (x as { v?: unknown }).v !== 1) return NO_ORDER_NOTES;
  const raw = (x as { notes?: unknown }).notes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NO_ORDER_NOTES;
  const kept: [string, OrderNote][] = [];
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const note = validNote(value);
    if (note && id.length > 0 && id.length <= TXN_ID_MAX) kept.push([id, note]);
  }
  kept.sort((a, b) => (a[1].date < b[1].date ? 1 : a[1].date > b[1].date ? -1 : 0));
  return { v: 1, notes: Object.fromEntries(kept.slice(0, ORDER_LIMITS.notes)) };
}

/**
 * A match from the browser, checked against the person's own transaction: it
 * must exist, be money out to Amazon, come after the order (and not long
 * after), and its items must add up to exactly what the bank says.
 */
export function validOrderMatch(x: unknown, byId: Map<string, BankLine>): [string, OrderNote] | null {
  if (!x || typeof x !== "object") return null;
  const m = x as Record<string, unknown>;
  if (typeof m.txnId !== "string") return null;
  const txn = byId.get(m.txnId);
  const note = validNote(m);
  if (!txn || !note || txn.amount >= 0 || !isAmazon(txn.merchant)) return null;
  if (txn.date < addDays(note.date, -ORDER_LIMITS.lagBefore) || txn.date > addDays(note.date, ORDER_LIMITS.shipsWithin)) return null;
  if (note.items.reduce((s, i) => s + i.amount, 0) !== -txn.amount) return null;
  return [txn.id, note];
}

/** New notes over old, newest orders kept past the limit. */
export function mergeOrderNotes(old: OrderNotes, added: [string, OrderNote][]): OrderNotes {
  return validOrderNotes({ v: 1, notes: { ...old.notes, ...Object.fromEntries(added) } });
}

/** Each transaction with what it paid for, when that's known. Never changes the transactions it's given. */
export function applyOrderNotes<T extends Transaction>(txns: T[], notes: OrderNotes): T[] {
  if (!Object.keys(notes.notes).length) return txns;
  return txns.map((t) => (Object.hasOwn(notes.notes, t.id) ? { ...t, order: notes.notes[t.id]! } : t));
}

/** A charge's items as a ledger line reads them: "Dog food, USB-C cable and 2 more". */
export function orderLabel(n: Pick<OrderNote, "items">): string {
  const short = (s: string) => ([...s].length > 40 ? `${[...s].slice(0, 39).join("").trimEnd()}…` : s);
  const names = n.items.map((i) => short(i.name));
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/** A charge's items as the parts of a split: at most `max`, the smallest added up as the last, always totalling the charge. */
export function itemParts(items: OrderItem[], max: number): { name: string; amount: Cents }[] {
  const parts = items.map((i) => ({ name: i.name, amount: i.amount }));
  if (parts.length <= max) return parts;
  const big = [...parts].sort((a, b) => b.amount - a.amount);
  const head = big.slice(0, max - 1);
  const rest = big.slice(max - 1);
  return [...head, { name: `${rest.length} other items`, amount: rest.reduce((s, x) => s + x.amount, 0) }];
}
