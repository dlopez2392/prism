// Business categories and Schedule C (schedule-c.ts, details.ts): each line in
// a business account put where it goes on the form, by the person's word on
// the line, then on its shop, then Prism's guess; and the year summed.

import { describe, expect, it } from "vitest";
import { NO_DETAILS, validDetails, withBizSort } from "./details";
import { bizLineLabel, guessBizLine, scheduleC, sortBusiness } from "./schedule-c";
import { taxSummary } from "./taxes";
import { tx } from "./test-helpers";
import type { Account, Transaction } from "./types";

const TODAY = "2026-10-21";
const account = (id: string): Account => ({ id, institutionId: "bofa", name: id, mask: null, kind: "checking", balance: 0, history: [] }) as unknown as Account;

const at = (t: Transaction, extra: Partial<Transaction>): Transaction => ({ ...t, ...extra });

describe("guessing where a business line goes", () => {
  const g = (amount: number, merchant: string, category: Parameters<typeof tx>[3]) => guessBizLine(tx("2026-10-01", amount, merchant, category, "biz"));

  it("reads money in as sales, interest as other income, and money moved in as the owner's", () => {
    expect(g(250_000, "Client invoice", "income")).toBe("sales");
    expect(g(1_200, "Interest paid", "income")).toBe("other-income");
    expect(g(500_000, "Transfer from Personal Checking", "transfer")).toBe("owner");
  });

  it("reads a name before a category, and a plain word only where it can mean what it says", () => {
    expect(g(-4_500, "Stripe fee", "other")).toBe("commissions");
    expect(g(-320_000, "Gusto payroll", "transfer")).toBe("wages");
    expect(g(-60_000, "Upwork", "other")).toBe("contract-labor");
    expect(g(-12_000, "Google Ads", "other")).toBe("advertising");
    expect(g(-2_999, "Adobe", "shopping")).toBe("office");
    expect(g(-8_900, "Verizon Wireless", "bills")).toBe("utilities");
    expect(g(-4_510, "Shell", "transport")).toBe("car");
    // "Power" in a restaurant's name is a meal, not the electric bill.
    expect(g(-1_850, "Power Burger", "food")).toBe("meals");
    expect(g(-41_000, "Delta Air Lines", "travel")).toBe("travel");
    expect(g(-9_000, "Home Depot", "shopping")).toBe("supplies");
  });

  it("never counts the owner's own income tax as a business cost, but a license is one", () => {
    expect(guessBizLine(at(tx("2026-04-15", -300_000, "IRS USATAXPYMT", "bills", "biz"), { taxHint: "tax-payment" }))).toBe("owner");
    expect(guessBizLine(at(tx("2026-01-15", -5_000, "Texas Secretary of State license", "bills", "biz"), { taxHint: "tax-payment" }))).toBe("taxes");
    expect(guessBizLine(at(tx("2026-10-01", -2_300, "Interest charge", "other", "biz"), { interestCharge: true }))).toBe("interest");
    expect(guessBizLine(at(tx("2026-10-01", -1_200, "Monthly service fee", "other", "biz"), { bankFee: "monthly" as never }))).toBe("other-expense");
  });
});

describe("the person's word", () => {
  it("beats the guess on its shop, and on one line beats its shop", () => {
    const a = tx("2026-10-01", -10_000, "Costco", "shopping", "biz");
    const b = tx("2026-10-08", -12_000, "Costco", "shopping", "biz");
    const refund = tx("2026-10-09", 3_000, "Costco", "shopping", "biz");
    let details = withBizSort(NO_DETAILS, a.id, null, { key: "out:costco", value: { name: "Costco", line: "goods" } });
    details = withBizSort(details, b.id, "meals");
    // Kept and read back as stored.
    details = validDetails(JSON.parse(JSON.stringify(details)));
    const [x, y, z] = sortBusiness([a, b, refund], { lines: details.biz ?? {}, shops: details.bizShops ?? {} });
    expect(x).toMatchObject({ biz: "goods", how: "shop", own: null, shop: "goods", guess: "supplies" });
    expect(y).toMatchObject({ biz: "meals", how: "you", own: "meals", shop: "goods" });
    // Money back from a purchase goes the purchase's way, so it follows the shop too.
    expect(z).toMatchObject({ biz: "goods", how: "shop", side: "out" });
  });

  it("drops a place that can't hold the money's way, and a shop key no name could make", () => {
    const stored = validDetails({ v: 1, lines: {}, biz: { t1: "bogus", t2: "meals" }, bizShops: { "in:client": { name: "Client", line: "meals" }, "sideways:x": { name: "X", line: "sales" }, "in:Not A Key": { name: "Y", line: "sales" }, "out:costco": { name: "Costco", line: "goods" } } });
    expect(stored.biz).toEqual({ t2: "meals" });
    expect(stored.bizShops).toEqual({ "out:costco": { name: "Costco", line: "goods" } });
    // A cost kept for a line that turns out to be money in is never used.
    const pay = tx("2026-10-01", 50_000, "Client invoice", "income", "biz");
    expect(sortBusiness([pay], { lines: { [pay.id]: "meals" }, shops: {} })[0]).toMatchObject({ biz: "sales", how: "guess" });
  });
});

describe("Schedule C", () => {
  const lines = () => [
    tx("2026-03-03", 250_000, "Client invoice", "income", "biz"),
    tx("2026-05-03", 180_000, "Client invoice", "income", "biz"),
    tx("2026-05-04", -15_000, "Refund to client", "other", "biz"),
    tx("2026-06-01", 900, "Interest paid", "income", "biz"),
    tx("2026-03-05", -40_000, "Supplier Co", "shopping", "biz"),
    tx("2026-03-09", 5_000, "Supplier Co", "shopping", "biz"),
    tx("2026-04-02", -6_000, "Google Ads", "other", "biz"),
    tx("2026-04-10", -8_000, "Luigi's Trattoria", "food", "biz"),
    tx("2026-04-11", -100_000, "Transfer to Personal Checking", "transfer", "biz"),
    tx("2026-04-12", -3_000, "Netflix", "fun", "biz"),
    // The business moving its own money, and last year's: neither is here.
    tx("2026-05-12", -20_000, "Transfer to Business Savings", "transfer", "biz"),
    tx("2026-05-12", 20_000, "Transfer from Business Checking", "transfer", "biz-sav"),
    tx("2025-12-30", 99_000, "Client invoice", "income", "biz"),
    // A personal account's line: never the business's.
    tx("2026-04-04", -9_000, "Groceries", "food", "chk"),
  ];

  it("sums the year by the form's lines, the person's word included, and says what the bank saw left", () => {
    const all = lines();
    const refund = all[2]!;
    const netflix = all[9]!;
    const s = scheduleC(
      {
        transactions: all,
        today: TODAY,
        accounts: [account("chk")],
        hiddenAccounts: [account("biz"), account("biz-sav")],
        businessAccountIds: ["biz", "biz-sav"],
        businessMarks: { lines: { [refund.id]: "sales", [netflix.id]: "personal" }, shops: {} },
      },
      2026,
    )!;
    expect(s.accounts.map((a) => a.id)).toEqual(["biz", "biz-sav"]);
    expect(s).toMatchObject({ receipts: 430_000, returns: 15_000, otherIncome: 900 });
    expect(s.costs.map((c) => [c.line, c.id, c.total])).toEqual([
      ["8", "advertising", 6_000],
      ["22", "supplies", 35_000],
      ["24b", "meals", 8_000],
    ]);
    expect(s.costsTotal).toBe(49_000);
    expect(s.net).toBe(430_000 - 15_000 + 900 - 49_000);
    expect(s.owner).toMatchObject({ in: 0, out: 100_000 });
    expect(s.personal.total).toBe(3_000);
    expect(s.guessed).toBe(s.lines.length - 2);
    expect(s.lines.every((x) => x.date >= "2026-01-01" && x.accountId !== "chk" && !x.merchant.includes("Business"))).toBe(true);
  });

  it("is nothing without a business account, and its lines leave the personal tax summary", () => {
    const all = lines();
    expect(scheduleC({ transactions: all, today: TODAY, accounts: [account("biz")], businessAccountIds: [] }, 2026)).toBeNull();
    const personal = taxSummary({ transactions: all, today: TODAY, businessAccountIds: ["biz", "biz-sav"] }, 2026);
    expect(personal.sections.find((x) => x.id === "other-income")).toBeUndefined();
    expect(taxSummary({ transactions: all, today: TODAY }, 2026).sections.find((x) => x.id === "other-income")?.total).toBe(430_000);
  });

  it("names each place with its line", () => {
    expect(bizLineLabel("advertising")).toBe("Line 8 · Advertising");
    expect(bizLineLabel("owner")).toBe("Paid to you, or put in by you");
  });
});
