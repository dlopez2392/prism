// The tax summary (taxes.ts): each line in the one section a return asks
// about, found by the bank's category unless the person has said otherwise,
// then by a name that can't fool it; never a pending line, a future one or a
// transfer between the person's own accounts.

import { describe, expect, it } from "vitest";
import { buildDemoData } from "./demo";
import { defaultTaxYear, GIFT_RECEIPT_FROM, TAX_SECTIONS, taxSummary, type TaxSectionId } from "./taxes";
import { tx } from "./test-helpers";
import type { Transaction } from "./types";

const money = (today: string, transactions: Transaction[]) => ({ today, transactions });
const hint = (t: Transaction, taxHint: Transaction["taxHint"]): Transaction => ({ ...t, taxHint });
const app = (t: Transaction, dir: "to" | "from", name: string, note: string | null = null): Transaction => ({ ...t, p2p: { app: "venmo", dir, name, note, date: t.date } });

/** Which section each merchant landed in, and the ones that landed nowhere. */
function placed(transactions: Transaction[], today = "2026-12-31", year = 2026) {
  const s = taxSummary(money(today, transactions), year);
  const where = new Map<string, TaxSectionId | "political">();
  for (const sec of s.sections) for (const t of sec.lines) where.set(t.id, sec.id);
  for (const t of s.political) where.set(t.id, "political");
  return (t: Transaction) => where.get(t.id) ?? null;
}

describe("money in", () => {
  it("sorts income by kind: the bank's word, else the name's", () => {
    const pay = tx("2026-03-01", 300_000, "Acme Payroll", "income");
    const interest = { ...tx("2026-03-31", 412, "HIGH YIELD SAVINGS", "income"), incomeKind: "interest" as const };
    const dividends = tx("2026-04-02", 9_100, "Vanguard dividend", "income");
    const pension = tx("2026-05-01", 120_000, "State pension", "income");
    const ui = tx("2026-05-08", 45_000, "Unemployment benefits", "income");
    const refund = tx("2026-04-20", 80_000, "IRS TREAS 310 TAX REF", "income");
    const client = tx("2026-06-10", 65_000, "Studio Kiln — client payment", "income");
    const at = placed([pay, interest, dividends, pension, ui, refund, client]);
    expect([pay, interest, dividends, pension, ui, refund, client].map(at)).toEqual(["pay", "interest", "dividends", "benefits", "benefits", "refunds", "other-income"]);
  });

  it("never counts money going out of an income line, or money in that isn't income", () => {
    const clawback = tx("2026-03-02", -5_000, "Acme Payroll", "income");
    const fromFriend = app(tx("2026-03-03", 4_000, "Venmo", "transfer"), "from", "Alex Kim", "dinner");
    const at = placed([clawback, fromFriend]);
    expect([clawback, fromFriend].map(at)).toEqual([null, null]);
  });
});

describe("money out, by the bank's category", () => {
  it("puts each hint in its section", () => {
    const lines = [
      hint(tx("2026-02-01", -5_000, "St Jude Children's", "other"), "donation"),
      hint(tx("2026-02-02", -12_000, "Dr Patel", "health"), "medical"),
      hint(tx("2026-04-15", -150_000, "US Treasury", "other"), "tax-payment"),
      hint(tx("2026-02-03", -180_000, "Lakeside Servicing", "housing"), "mortgage"),
      hint(tx("2026-02-04", -21_000, "Federal Loans", "bills"), "student-loan"),
      hint(tx("2026-02-05", -90_000, "Little Acorns", "bills"), "childcare"),
      hint(tx("2026-02-06", -400_000, "State U", "bills"), "education"),
    ];
    expect(lines.map(placed(lines))).toEqual(["gifts", "medical", "taxes-paid", "mortgage", "student-loans", "childcare", "education"]);
  });

  it("drops the bank's word once the person has moved the line to another category", () => {
    const moved = { ...hint(tx("2026-02-02", -3_000, "Corner Pharmacy & Gifts", "shopping"), "medical"), bankCategory: "health" as const };
    expect(placed([moved])(moved)).toBeNull();
  });

  it("keeps a campaign out of gifts to charity, and a vitamin shop out of medical", () => {
    const campaign = hint(tx("2026-05-01", -5_000, "ACTBLUE*SMITH FOR SENATE", "other"), "donation");
    const vitamins = hint(tx("2026-05-02", -4_500, "The Vitamin Shoppe", "health"), "medical");
    const at = placed([campaign, vitamins]);
    expect([at(campaign), at(vitamins)]).toEqual(["political", null]);
  });
});

describe("money out, by name", () => {
  it("finds each section by a name that says it", () => {
    const lines = [
      tx("2026-04-15", -120_000, "IRS USATAXPYMT", "other"),
      tx("2026-11-01", -210_000, "County Tax Collector", "housing"),
      tx("2026-03-01", -185_000, "Rocket Mortgage", "housing"),
      tx("2026-03-02", -21_000, "Federal student loan payment", "bills"),
      tx("2026-03-03", -95_000, "Bright Horizons", "other"),
      tx("2026-03-04", -6_400, "Brightside Dental", "health"),
      tx("2026-03-05", -2_500, "Riverside Food Bank", "other"),
      tx("2026-03-06", -10_000, "Grace Church", "bills"),
      tx("2026-08-20", -320_000, "Bursar — State University", "other"),
    ];
    expect(lines.map(placed(lines))).toEqual(["taxes-paid", "taxes-paid", "mortgage", "student-loans", "childcare", "medical", "gifts", "gifts", "education"]);
  });

  it("refuses the names that fool a word list", () => {
    const lines = [
      tx("2026-03-01", -1_800, "Church's Chicken", "other"),
      tx("2026-03-02", -2_400, "Church Street Deli", "other"),
      tx("2026-03-03", -1_500, "Charity Thrift Shop", "other"),
      tx("2026-03-04", -4_000, "FitClub Gym", "health"),
      tx("2026-03-05", -6_000, "Paws Vet Clinic", "health"),
      tx("2026-03-06", -2_000, "University Pizza", "food"),
      tx("2026-03-07", -30_000, "University Credit Union", "bills"),
      tx("2026-03-08", -3_000, "Walgreens", "shopping"),
      tx("2026-03-09", -5_000, "WinRed donation", "other"),
      tx("2026-03-10", -5_000, "TurboTax", "bills"),
      tx("2026-03-11", -9_000, "State University Athletics Tickets", "other"),
      hint(tx("2026-03-12", 5_000, "ACTBLUE REFUND", "other"), "donation"),
    ];
    const at = placed(lines);
    expect(lines.map(at)).toEqual([null, null, null, null, null, null, null, null, "political", null, null, null]);
  });

  it("reads who a Venmo payment went to, and the person's own note, but never a note for a gift", () => {
    const sitter = app(tx("2026-06-01", -12_000, "Venmo", "transfer"), "to", "Maria Lopez", "babysitting Friday");
    const church = app(tx("2026-06-02", -5_000, "Venmo", "transfer"), "to", "Grace Church");
    const party = app(tx("2026-06-03", -2_000, "Venmo", "transfer"), "to", "Sam Lee", "donation for the party");
    const paidMe = app(tx("2026-06-04", 12_000, "Venmo", "transfer"), "from", "Day Care Co-op");
    const at = placed([sitter, church, party, paidMe]);
    expect([sitter, church, party, paidMe].map(at)).toEqual(["childcare", "gifts", null, null]);
  });

  it("never counts a transfer between the person's own accounts, a pending line or one past the year", () => {
    const toSavings = tx("2026-03-01", -50_000, "Mortgage escrow transfer", "transfer");
    const pending = { ...tx("2026-03-02", -6_000, "Brightside Dental", "health"), pending: true };
    const later = tx("2027-01-02", -6_000, "Brightside Dental", "health");
    const at = placed([toSavings, pending, later]);
    expect([toSavings, pending, later].map(at)).toEqual([null, null, null]);
  });
});

describe("totals", () => {
  it("takes money back off what went out, only where it can come back", () => {
    const visit = tx("2026-03-01", -20_000, "Brightside Dental", "health");
    const back = tx("2026-03-20", 5_000, "Brightside Dental", "health");
    const gift = tx("2026-04-01", -10_000, "Red Cross", "other");
    const giftBack = tx("2026-04-02", 10_000, "Red Cross", "other");
    const s = taxSummary(money("2026-12-31", [visit, back, gift, giftBack]), 2026);
    expect(s.sections.find((x) => x.id === "medical")).toMatchObject({ total: 15_000, lines: [back, visit] });
    expect(s.sections.find((x) => x.id === "gifts")).toMatchObject({ total: 10_000, lines: [gift] });
  });

  it("never shows a total below nothing", () => {
    const back = tx("2026-03-20", 5_000, "Brightside Dental", "health");
    expect(taxSummary(money("2026-12-31", [back]), 2026).sections[0]).toMatchObject({ id: "medical", total: 0 });
  });

  it("lists every section a return asks about, found or not, in order", () => {
    const s = taxSummary(money("2026-12-31", [tx("2026-03-01", 300_000, "Acme Payroll", "income"), tx("2026-03-04", -6_400, "Brightside Dental", "health")]), 2026);
    expect(s.sections.map((x) => x.id)).toEqual(["pay", "medical"]);
    expect([...s.sections.map((x) => x.id), ...s.nothing.map((x) => x.id)].sort()).toEqual(TAX_SECTIONS.map((x) => x.id).sort());
    expect(s.sections[0]).toMatchObject({ side: "in", form: "W-2", total: 300_000 });
  });

  it("tells 2026 and later about the gift deduction for people who don't itemize, and earlier years nothing of it", () => {
    const gift = (d: string) => tx(d, -10_000, "Red Cross", "other");
    const note = (year: number) => taxSummary(money(`${year}-12-31`, [gift(`${year}-05-01`)]), year).sections[0]!.note;
    expect(note(2026)).toMatch(/even if you don't itemize/);
    expect(note(2025)).not.toMatch(/even if you don't itemize/);
    expect(note(2025)).toMatch(/\$250/);
    expect(GIFT_RECEIPT_FROM).toBe(25_000);
  });
});

describe("the span and the year", () => {
  it("is honest about a year under way and records that start late", () => {
    const s = taxSummary(money("2026-10-04", [tx("2026-03-15", -6_400, "Brightside Dental", "health")]), 2026);
    expect(s).toMatchObject({ from: "2026-03-15", to: "2026-10-04", partial: true, recordsFrom: "2026-03-15", transactions: 1 });
  });

  it("means last year until the April deadline has passed", () => {
    const both = [tx("2025-06-01", -100, "A", "other"), tx("2026-01-05", -100, "B", "other")];
    expect(defaultTaxYear(money("2026-04-30", both))).toBe(2025);
    expect(defaultTaxYear(money("2026-05-01", both))).toBe(2026);
    expect(defaultTaxYear(money("2026-02-01", [tx("2026-01-05", -100, "B", "other")]))).toBe(2026);
    expect(defaultTaxYear(money("2026-02-01", []))).toBe(2026);
  });

  it("finds the example household's pay, interest, gifts, medical and student loans", () => {
    const d = buildDemoData("2026-10-04");
    const s = taxSummary(d, 2026);
    expect(s.sections.map((x) => x.id)).toEqual(["pay", "interest", "other-income", "gifts", "medical", "student-loans"]);
    // The gym is health, not medical.
    expect(s.sections.find((x) => x.id === "medical")!.lines.every((t) => !/gym/i.test(t.merchant))).toBe(true);
  });
});
