// A person's business accounts (business.ts, details.ts): kept apart from
// every personal total, and summed on their own.

import { describe, expect, it } from "vitest";
import { businessFor } from "./business";
import { applyDetails, hideAccounts, NO_DETAILS, validDetails, withBusiness, withHidden } from "./details";
import { buildDemoData } from "./demo";
import { analyze } from "./model";
import { tx } from "./test-helpers";
import type { Account } from "./types";

const TODAY = "2026-10-21";
const account = (id: string, balance: number): Account => ({ id, institutionId: "bofa", name: id, mask: null, kind: "checking", balance, history: [] }) as unknown as Account;

describe("business accounts", () => {
  it("sums what came in and went out of them by month, owner's pay included, the business's own moves not", () => {
    const lines = [
      tx("2026-10-03", 250_000, "Client invoice", "income", "biz"),
      tx("2026-10-05", -40_000, "Supplier", "shopping", "biz"),
      tx("2026-10-10", -100_000, "Transfer to Personal Checking", "transfer", "biz"),
      // Moving money between the business's own two accounts.
      tx("2026-10-12", -20_000, "Transfer to Business Savings", "transfer", "biz"),
      tx("2026-10-12", 20_000, "Transfer from Business Checking", "transfer", "biz-sav"),
      tx("2026-09-14", 180_000, "Client invoice", "income", "biz"),
      tx("2026-10-04", -9_000, "Groceries", "food", "chk"),
    ];
    const b = businessFor([account("biz", 500_000), account("biz-sav", 300_000), account("old", 1)], ["biz", "biz-sav"], lines, TODAY)!;
    expect(b.accounts.map((a) => a.id)).toEqual(["biz", "biz-sav"]);
    expect(b.balance).toBe(800_000);
    expect(b.months[0]).toMatchObject({ month: "2026-10", moneyIn: 250_000, moneyOut: 140_000, net: 110_000 });
    expect(b.months[1]).toMatchObject({ month: "2026-09", moneyIn: 180_000, moneyOut: 0 });
    expect(businessFor([account("biz", 1)], [], lines, TODAY)).toBeNull();
  });

  it("keeps a business account out of every personal total, and remembers which accounts are business", () => {
    const data = buildDemoData(TODAY);
    const card = data.accounts.find((a) => a.kind === "credit")!;
    const details = withBusiness(NO_DETAILS, card.id, true);
    expect(validDetails(JSON.parse(JSON.stringify(details))).business).toEqual([card.id]);
    const apart = hideAccounts({ ...data, transactions: applyDetails(data.transactions, details) }, details);
    expect(apart.accounts.some((a) => a.id === card.id)).toBe(false);
    expect(apart.businessAccountIds).toEqual([card.id]);
    expect(apart.transactions.filter((t) => t.accountId === card.id).every((t) => t.excluded === "account")).toBe(true);
    // Its spending leaves the personal totals.
    expect(analyze(apart).mtd).toBeDefined();
    expect(analyze(apart).spentMTD).toBeLessThan(analyze(data).spentMTD);
    // Left out and business are two marks: undoing one leaves the other.
    const both = withHidden(details, card.id, true);
    expect(withBusiness(both, card.id, false).hidden).toEqual([card.id]);
    expect(withBusiness(details, card.id, false).business).toBeUndefined();
  });
});
