// What an Amazon charge paid for (orders.ts): Amazon's own order history,
// read in the browser, matched to the bank's charges a shipment at a time,
// and checked again on the server to the cent.

import { describe, expect, it } from "vitest";
import {
  applyOrderNotes,
  isAmazon,
  itemParts,
  keptItems,
  matchOrders,
  mergeOrderNotes,
  NO_ORDER_NOTES,
  ORDER_LIMITS,
  orderLabel,
  readAmazonFile,
  validOrderMatch,
  validOrderNotes,
  type BankLine,
  type OrderRow,
} from "./orders";
import { tx } from "./test-helpers";

const HEADER =
  '"Website","Order ID","Order Date","Purchase Order Number","Currency","Unit Price","Unit Price Tax","Shipping Charge","Total Discounts","Total Owed","Shipment Item Subtotal","Shipment Item Subtotal Tax","ASIN","Product Condition","Quantity","Payment Instrument Type","Order Status","Shipment Status","Ship Date","Shipping Option","Shipping Address","Billing Address","Carrier Name & Tracking Number","Product Name","Gift Message","Gift Sender Name","Gift Recipient Contact Details","Item Serial Number"';
const item = (order: string, date: string, owed: string, ship: string, name: string, extra: { qty?: number; currency?: string; status?: string } = {}) =>
  [
    "Amazon.com",
    order,
    `${date}T15:04:05Z`,
    "Not Applicable",
    extra.currency ?? "USD",
    owed,
    "0",
    "0",
    "0",
    owed,
    owed,
    "0",
    "B000000000",
    "New",
    String(extra.qty ?? 1),
    "Visa - 1234",
    extra.status ?? "Closed",
    "Shipped",
    ship === "Not Available" ? ship : `${ship}T20:11:00.000Z`,
    "std-us",
    "1 Main St",
    "1 Main St",
    "AMZN_US(TBA000)",
    name,
    "Not Available",
    "Not Available",
    "Not Available",
    "Not Available",
  ]
    .map((c) => `"${c.replace(/"/g, '""')}"`)
    .join(",");

const FILE = [
  HEADER,
  // One order, two shipments: charged as each left.
  item("111-0000001-0000001", "2026-09-02", "24.99", "2026-09-03", "Dog food, 12 lb bag"),
  item("111-0000001-0000001", "2026-09-02", "9.98", "2026-09-03", "USB-C cable", { qty: 2 }),
  item("111-0000001-0000001", "2026-09-02", "31.50", "2026-09-09", 'Desk lamp, "warm" LED'),
  // Charged once for two shipments.
  item("111-0000002-0000002", "2026-09-12", "15.00", "2026-09-13", "Notebook"),
  item("111-0000002-0000002", "2026-09-12", "5.00", "2026-09-20", "Pens"),
  // Never charged to a card Prism sees (a gift card).
  item("111-0000003-0000003", "2026-09-15", "40.00", "2026-09-16", "Gift wrap"),
  // Skipped: cancelled, another currency, nothing owed.
  item("111-0000004-0000004", "2026-09-16", "12.00", "Not Available", "Cancelled thing", { status: "Cancelled" }),
  item("202-0000005-0000005", "2026-09-17", "8.00", "2026-09-18", "Something abroad", { currency: "EUR" }),
  item("111-0000006-0000006", "2026-09-18", "0", "2026-09-18", "A free sample"),
].join("\n");

const bank: BankLine[] = [
  { ...tx("2026-09-04", -3_497, "AMZN Mktp US*2K4AB", "shopping"), id: "a1" },
  { ...tx("2026-09-10", -3_150, "AMAZON.COM*9Z8Y7", "shopping"), id: "a2" },
  { ...tx("2026-09-14", -2_000, "Amazon.com", "shopping"), id: "a3" },
  // Same amount, but not Amazon.
  { ...tx("2026-09-04", -3_497, "Amazonas Grill", "food"), id: "x1" },
];

describe("reading Amazon's file", () => {
  it("reads each item: its order, the day it was ordered and shipped, how many, and what it cost", () => {
    const file = readAmazonFile(FILE)!;
    expect(file.rows).toHaveLength(6);
    expect(file.rows[0]).toEqual({ order: "111-0000001-0000001", date: "2026-09-02", ship: "2026-09-03", name: "Dog food, 12 lb bag", qty: 1, amount: 2_499 });
    expect(file.rows[1]).toMatchObject({ name: "USB-C cable", qty: 2, amount: 998 });
    expect(file.rows[2]!.name).toBe('Desk lamp, "warm" LED');
    // Cancelled, another currency, nothing owed: counted, never guessed at.
    expect(file.skipped).toBe(3);
  });

  it("says plainly when a file isn't Amazon's order history", () => {
    expect(readAmazonFile("Date,Description,Amount\n2026-09-01,Coffee,-4.50")).toBeNull();
    expect(readAmazonFile("")).toBeNull();
  });

  it("cleans what sellers wrote: one line, no hidden marks, kept short", () => {
    const file = readAmazonFile([HEADER, item("111-1", "2026-09-02", "5.00", "2026-09-03", `Lamp‮\u0007 ${"x".repeat(300)}`)].join("\n"))!;
    expect(file.rows[0]!.name).not.toMatch(/[‮\u0007]/);
    expect([...file.rows[0]!.name].length).toBeLessThanOrEqual(ORDER_LIMITS.name);
  });
});

describe("matching charges to the bank", () => {
  const { rows } = readAmazonFile(FILE)!;
  const result = matchOrders(rows, bank);

  it("pairs each shipment with the charge it caused, to the cent, from an Amazon line only", () => {
    const first = result.matches.find((m) => m.txnId === "a1")!;
    expect(first.items.map((i) => i.name)).toEqual(["Dog food, 12 lb bag", "USB-C cable"]);
    expect(first.items.reduce((s, i) => s + i.amount, 0)).toBe(3_497);
    expect(result.matches.find((m) => m.txnId === "a2")!.items.map((i) => i.name)).toEqual(['Desk lamp, "warm" LED']);
    expect(result.matches.some((m) => m.txnId === "x1")).toBe(false);
  });

  it("pairs a whole order charged once, when no shipment alone matches", () => {
    expect(result.matches.find((m) => m.txnId === "a3")!.items.map((i) => i.name)).toEqual(["Notebook", "Pens"]);
  });

  it("counts the orders nothing matched", () => {
    expect(result).toMatchObject({ orders: 3, unmatched: 1, from: "2026-09-02", to: "2026-09-15" });
  });

  it("keeps to the window: a day before the shipment to six days after", () => {
    const late = [{ ...bank[0]!, date: "2026-09-10" }];
    const early = [{ ...bank[0]!, date: "2026-09-01" }];
    expect(matchOrders(rows, late).matches.some((m) => m.items[0]!.name === "Dog food, 12 lb bag")).toBe(false);
    expect(matchOrders(rows, early).matches).toHaveLength(0);
  });

  it("never counts an item twice, nor pairs two charges with one line", () => {
    const twin: OrderRow[] = [
      { order: "A", date: "2026-09-01", ship: "2026-09-02", name: "Tea", qty: 1, amount: 1_000 },
      { order: "B", date: "2026-09-01", ship: "2026-09-02", name: "Coffee", qty: 1, amount: 1_000 },
    ];
    const one = matchOrders(twin, [{ id: "t", date: "2026-09-03", amount: -1_000, merchant: "AMAZON.COM" }]);
    expect(one.matches).toHaveLength(1);
    expect(one.unmatched).toBe(1);
  });

  it("knows Amazon's bank descriptors", () => {
    for (const m of ["AMZN Mktp US*2K4", "AMAZON.COM*AB12", "Amazon Fresh", "amzn digital*1x2"]) expect(isAmazon(m)).toBe(true);
    for (const m of ["Amazonas Grill", "Venmo", "AMZNX Corp"]) expect(isAmazon(m)).toBe(false);
  });
});

describe("keeping what a charge paid for", () => {
  it("adds up the items past the limit as one, so they always total the charge", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ name: `Item ${i}`, qty: 1, amount: 100 + i }));
    const kept = keptItems(many);
    expect(kept).toHaveLength(ORDER_LIMITS.items);
    expect(kept.at(-1)).toMatchObject({ name: "6 more items", qty: 6 });
    expect(kept.reduce((s, i) => s + i.amount, 0)).toBe(many.reduce((s, i) => s + i.amount, 0));
  });

  it("reads kept notes as untrusted, dropping a bad entry on its own", () => {
    const good = { order: "111-1", date: "2026-09-02", items: [{ name: "Tea", qty: 1, amount: 500 }] };
    const kept = validOrderNotes({ v: 1, notes: { a: good, b: { ...good, items: [] }, c: { ...good, date: "yesterday" }, d: { ...good, items: [{ name: "Tea", qty: 0, amount: 500 }] } } });
    expect(Object.keys(kept.notes)).toEqual(["a"]);
    expect(validOrderNotes({ v: 2, notes: { a: good } })).toEqual(NO_ORDER_NOTES);
  });

  it("keeps the newest orders past the limit, and lets new notes replace old", () => {
    const notes = Object.fromEntries(
      Array.from({ length: ORDER_LIMITS.notes + 5 }, (_, i) => [`t${i}`, { order: `o${i}`, date: `2026-${String(1 + (i % 9)).padStart(2, "0")}-01`, items: [{ name: "x", qty: 1, amount: 100 }] }]),
    );
    expect(Object.keys(validOrderNotes({ v: 1, notes }).notes)).toHaveLength(ORDER_LIMITS.notes);
    const merged = mergeOrderNotes({ v: 1, notes: { t: { order: "old", date: "2026-09-01", items: [{ name: "Old", qty: 1, amount: 100 }] } } }, [["t", { order: "new", date: "2026-09-01", items: [{ name: "New", qty: 1, amount: 100 }] }]]);
    expect(merged.notes.t!.order).toBe("new");
  });
});

describe("checking a match on the server", () => {
  const byId = new Map(bank.map((l) => [l.id, l]));
  const match = { txnId: "a1", order: "111-0000001-0000001", date: "2026-09-02", items: [{ name: "Dog food", qty: 1, amount: 2_499 }, { name: "USB-C cable", qty: 2, amount: 998 }] };

  it("accepts items that add up to the person's own Amazon charge, after the order", () => {
    expect(validOrderMatch(match, byId)).toEqual(["a1", { order: match.order, date: match.date, items: match.items }]);
  });

  it("refuses a line that isn't theirs, isn't Amazon, doesn't add up, or comes before the order", () => {
    expect(validOrderMatch({ ...match, txnId: "nope" }, byId)).toBeNull();
    expect(validOrderMatch({ ...match, txnId: "x1" }, byId)).toBeNull();
    expect(validOrderMatch({ ...match, items: [match.items[0]] }, byId)).toBeNull();
    expect(validOrderMatch({ ...match, date: "2026-09-06" }, byId)).toBeNull();
    expect(validOrderMatch({ ...match, date: "2026-03-01" }, byId)).toBeNull();
  });

  it("cleans what it keeps, whatever the browser sent", () => {
    const [, note] = validOrderMatch({ ...match, items: [{ ...match.items[0], name: "Dog‮ food" }, match.items[1]] }, byId)!;
    expect(note.items[0]!.name).toBe("Dog food");
  });
});

describe("showing what a charge paid for", () => {
  const note = { order: "111-1", date: "2026-09-02", items: [{ name: "Dog food", qty: 1, amount: 2_499 }, { name: "USB-C cable", qty: 2, amount: 998 }, { name: "Lamp", qty: 1, amount: 3_150 }, { name: "Pens", qty: 1, amount: 500 }] };

  it("adds the items to the person's own line, and never changes the transactions it's given", () => {
    const lines = [{ ...tx("2026-09-04", -3_497, "AMZN Mktp US", "shopping"), id: "a1" }, { ...tx("2026-09-05", -500, "Corner Deli", "food"), id: "d" }];
    const out = applyOrderNotes(lines, { v: 1, notes: { a1: note } });
    expect(out[0]!.order).toEqual(note);
    expect(out[1]).toBe(lines[1]);
    expect(lines[0]).not.toHaveProperty("order");
  });

  it("reads as a ledger line: two names and how many more", () => {
    expect(orderLabel(note)).toBe("Dog food, USB-C cable and 2 more");
    expect(orderLabel({ items: [note.items[0]!] })).toBe("Dog food");
  });

  it("splits into at most so many parts, the smallest added up as the last, totalling the charge", () => {
    const parts = itemParts(note.items, 3);
    expect(parts.map((p) => p.name)).toEqual(["Lamp", "Dog food", "2 other items"]);
    expect(parts.reduce((s, p) => s + p.amount, 0)).toBe(note.items.reduce((s, i) => s + i.amount, 0));
  });
});
