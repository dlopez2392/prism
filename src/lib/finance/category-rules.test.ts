// A person's category fixes (category-rules.ts): how they apply, how they're
// kept, and what an untrusted stored copy can and can't do.

import { describe, expect, it } from "vitest";
import {
  choicesFor,
  MAX_MERCHANT_RULES,
  merchantKey,
  NO_RULES,
  recategorize,
  ruleFor,
  validCategoryRules,
  withFix,
  type CategoryRules,
} from "./category-rules";
import type { Transaction } from "./types";

const tx = (id: string, merchant: string, amount: number, category: Transaction["category"]): Transaction => ({
  id,
  accountId: "a1",
  date: "2026-09-01",
  amount,
  merchant,
  category,
  pending: false,
});
const rules = (merchants: CategoryRules["merchants"] = {}, transactions: CategoryRules["transactions"] = {}): CategoryRules => ({ v: 1, merchants, transactions });

describe("a merchant, as a fix sees it", () => {
  it("is the same merchant whatever the case, spacing or stray punctuation", () => {
    for (const m of ["Trader Joe's", "TRADER JOE'S", "  trader   joe's ", "Trader Joe's *", "trader joe's."]) expect(merchantKey(m)).toBe("trader joe's");
  });
});

describe("applying fixes", () => {
  const coffee = tx("t1", "Blue Bottle", -550, "shopping");
  const coffee2 = tx("t2", "BLUE BOTTLE", -620, "shopping");
  const pay = tx("t3", "Acme Payroll", 250_000, "transfer");

  it("renames every purchase at a merchant, and keeps what the bank said", () => {
    const out = recategorize([coffee, coffee2], rules({ "blue bottle": "food" }));
    expect(out.map((t) => [t.category, t.bankCategory])).toEqual([
      ["food", "shopping"],
      ["food", "shopping"],
    ]);
  });

  it("lets a one-transaction fix beat the merchant's", () => {
    const out = recategorize([coffee, coffee2], rules({ "blue bottle": "food" }, { t2: "fun" }));
    expect(out.map((t) => t.category)).toEqual(["food", "fun"]);
  });

  it("never calls money going out income, whatever is stored", () => {
    expect(ruleFor(coffee, rules({ "blue bottle": "income" }))).toBeNull();
    expect(recategorize([coffee], rules({ "blue bottle": "income" }))[0]!.category).toBe("shopping");
    expect(recategorize([pay], rules({ "acme payroll": "income" }))[0]!.category).toBe("income");
    expect(choicesFor(-1)).not.toContain("income");
    expect(choicesFor(1)).toContain("income");
  });

  it("changes nothing, and hands back the same list, without fixes", () => {
    const list = [coffee, pay];
    expect(recategorize(list, NO_RULES)).toBe(list);
    expect(recategorize(list, rules({ nobody: "food" }))).toBe(list);
  });

  it("goes back to the bank's category when a fix is removed, on data that was already fixed", () => {
    const fixed = recategorize([coffee], rules({ "blue bottle": "food" }));
    const back = recategorize(fixed, rules({ other: "fun" }));
    expect(back[0]).toMatchObject({ category: "shopping" });
    expect(back[0]!.bankCategory).toBeUndefined();
  });
});

describe("making a fix", () => {
  it("for every purchase at a merchant replaces a one-off fix on this transaction", () => {
    const r = withFix(rules({}, { t1: "fun" }), { kind: "set", transactionId: "t1", merchant: "Blue Bottle", category: "food", everyAtMerchant: true });
    expect(r).toEqual(rules({ "blue bottle": "food" }));
  });

  it("for just one transaction leaves the merchant's fix in place", () => {
    const r = withFix(rules({ "blue bottle": "food" }), { kind: "set", transactionId: "t2", merchant: "Blue Bottle", category: "fun", everyAtMerchant: false });
    expect(r).toEqual(rules({ "blue bottle": "food" }, { t2: "fun" }));
  });

  it("back to the bank's categories clears the merchant's fix and this transaction's", () => {
    const r = withFix(rules({ "blue bottle": "food", other: "fun" }, { t1: "fun", t9: "bills" }), { kind: "reset", transactionId: "t1", merchant: "blue bottle" });
    expect(r).toEqual(rules({ other: "fun" }, { t9: "bills" }));
  });

  it("keeps the newest fixes when there are too many, and the latest wins", () => {
    let r = NO_RULES;
    for (let i = 0; i <= MAX_MERCHANT_RULES; i++) r = withFix(r, { kind: "set", transactionId: `t${i}`, merchant: `shop ${i}`, category: "food", everyAtMerchant: true });
    expect(Object.keys(r.merchants)).toHaveLength(MAX_MERCHANT_RULES);
    expect(r.merchants["shop 0"]).toBeUndefined();
    expect(r.merchants[`shop ${MAX_MERCHANT_RULES}`]).toBe("food");
    r = withFix(r, { kind: "set", transactionId: "x", merchant: "shop 1", category: "fun", everyAtMerchant: true });
    expect(Object.keys(r.merchants).at(-1)).toBe("shop 1");
  });
});

describe("a stored copy", () => {
  it("keeps each valid fix and drops each invalid one, rather than losing them all", () => {
    const stored = { v: 1, merchants: { "blue bottle": "food", junk: "not-a-category", "": "fun", ["x".repeat(201)]: "fun" }, transactions: { t1: "transfer", t2: 42 } };
    expect(validCategoryRules(stored)).toEqual(rules({ "blue bottle": "food" }, { t1: "transfer" }));
  });

  it("is nothing at all when it isn't a copy of fixes", () => {
    for (const junk of [null, undefined, "x", [], { v: 2, merchants: { a: "food" } }, { merchants: { a: "food" } }]) expect(validCategoryRules(junk)).toEqual(NO_RULES);
  });

  it("can't name a category that doesn't exist, even one hiding on the prototype", () => {
    expect(validCategoryRules({ v: 1, merchants: { a: "toString", b: "constructor" }, transactions: {} })).toEqual(NO_RULES);
  });
});
