// Leaving things out of the totals (details.ts): one line a person keeps out
// of every sum (a car, a work trip paid back), or a whole account (a business
// card, a closed account). Still listed, still theirs to download, counted in
// no spending, income, budget or net worth.

import { describe, expect, it } from "vitest";
import { categoryTotals, monthlyCashFlow, sumIncome, sumSpending, topMerchants } from "./cashflow";
import { buildDemoData } from "./demo";
import { applyDetails, everyAccount, hasDetails, hideAccounts, NO_DETAILS, validDetail, validDetails, withDetail, withHidden, type TxnDetails } from "./details";
import { analyze } from "./model";
import { netWorthSeries } from "./networth";
import { tx } from "./test-helpers";
import type { Transaction } from "./types";

const line = (id: string, ...args: Parameters<typeof tx>): Transaction => ({ ...tx(...args), id });
const car = line("car", "2026-09-12", -1_850_000, "Hilltop Motors", "transport");
const lunch = line("lunch", "2026-09-14", -2_400, "Corner Deli", "food");
const refund = line("expenses", "2026-09-20", 64_000, "Acme Expenses", "income");
const pay = line("pay", "2026-09-15", 300_000, "Acme Payroll", "income");
const bizCard = line("biz", "2026-09-18", -9_900, "Office Depot", "shopping", "biz-card");
const lines = [car, lunch, refund, pay, bizCard];

describe("what's kept", () => {
  it("keeps a line that's only left out, and drops nothing else it had", () => {
    expect(validDetail({ out: true })).toEqual({ out: true });
    expect(validDetail({ out: "yes" })).toBeNull();
    expect(validDetail({ tags: ["Work trip"], out: true })).toEqual({ tags: ["Work trip"], out: true });
  });

  it("keeps the accounts left out once each, only as ids it could be, and never more than it allows", () => {
    expect(validDetails({ v: 1, lines: {}, hidden: ["biz-card", "biz-card", "", 7, "x".repeat(201), "old-savings"] }).hidden).toEqual(["biz-card", "old-savings"]);
    expect(validDetails({ v: 1, lines: {}, hidden: "biz-card" }).hidden).toBeUndefined();
    expect(validDetails({ v: 1, lines: {}, hidden: Array.from({ length: 300 }, (_, i) => `a${i}`) }).hidden).toHaveLength(200);
  });

  it("is something to keep even when it's only an account left out, and goes when that's counted again", () => {
    const hidden = withHidden(NO_DETAILS, "biz-card", true);
    expect(hidden.hidden).toEqual(["biz-card"]);
    expect(hasDetails(hidden)).toBe(true);
    const back = withHidden(hidden, "biz-card", false);
    expect(back.hidden).toBeUndefined();
    expect(hasDetails(back)).toBe(false);
  });

  it("survives a change to any other line", () => {
    const hidden = withHidden(NO_DETAILS, "biz-card", true);
    expect(withDetail(hidden, "lunch", { tags: ["Team"] }).hidden).toEqual(["biz-card"]);
  });
});

describe("a line left out", () => {
  const details: TxnDetails = { v: 1, lines: { car: { out: true }, expenses: { out: true } } };
  const applied = applyDetails(lines, details);

  it("is still listed, and says so", () => {
    expect(applied).toHaveLength(lines.length);
    expect(applied.find((t) => t.id === "car")).toMatchObject({ excluded: "line", amount: -1_850_000 });
    expect(applied.find((t) => t.id === "lunch")?.excluded).toBeUndefined();
  });

  it("counts in no spending, income, category or shop total", () => {
    expect(sumSpending(applied, "2026-09-01", "2026-09-30")).toBe(2_400 + 9_900);
    expect(sumIncome(applied, "2026-09-01", "2026-09-30")).toBe(300_000);
    expect(categoryTotals(applied, "2026-09-01", "2026-09-30").transport).toBe(0);
    expect(topMerchants(applied, "2026-09-01", "2026-09-30").map((m) => m.merchant)).not.toContain("Hilltop Motors");
    expect(monthlyCashFlow(applied, ["2026-09"])[0]).toMatchObject({ income: 300_000, spending: 12_300 });
  });

  it("stays left out when it's split: every part is", () => {
    const parts = applyDetails([lunch], { v: 1, lines: { lunch: { out: true, split: [{ category: "food", amount: 1_400 }, { category: "fun", amount: 1_000 }] } } });
    expect(parts.map((t) => [t.id, t.excluded])).toEqual([
      ["lunch~1", "line"],
      ["lunch~2", "line"],
    ]);
  });
});

describe("an account left out", () => {
  it("leaves every line in it out", () => {
    const applied = applyDetails(lines, withHidden(NO_DETAILS, "biz-card", true));
    expect(applied.find((t) => t.id === "biz")?.excluded).toBe("account");
    // Left out with its account even when the line is left out itself: counting the account again is what brings it back.
    expect(applyDetails([bizCard], { v: 1, lines: { biz: { out: true } }, hidden: ["biz-card"] })[0]?.excluded).toBe("account");
    expect(sumSpending(applied, "2026-09-01", "2026-09-30")).toBe(1_850_000 + 2_400);
  });

  it("leaves net worth, with its holdings, and is listed to count again", () => {
    const data = buildDemoData("2026-10-05");
    const brokerage = data.accounts.find((a) => a.kind === "investment" && data.holdings.some((h) => h.accountId === a.id))!;
    const hidden = hideAccounts(data, withHidden(NO_DETAILS, brokerage.id, true));
    expect(hidden.accounts.map((a) => a.id)).not.toContain(brokerage.id);
    expect(hidden.hiddenAccounts).toEqual([brokerage]);
    expect(hidden.holdings.some((h) => h.accountId === brokerage.id)).toBe(false);
    expect(hidden.hiddenHoldings.length).toBeGreaterThan(0);
    expect(netWorthSeries(hidden.accounts, data.today).at(-1)!.net).toBe(netWorthSeries(data.accounts, data.today).at(-1)!.net - brokerage.balance);
    // A download is all of it again.
    const all = everyAccount(hidden);
    expect(all.accounts).toHaveLength(data.accounts.length);
    expect(all.holdings).toHaveLength(data.holdings.length);
  });

  it("changes nothing when no account is left out", () => {
    const data = buildDemoData("2026-10-05");
    const same = hideAccounts(data, null);
    expect(same.accounts).toBe(data.accounts);
    expect(same.hiddenAccounts).toEqual([]);
  });
});

describe("the screens' own numbers", () => {
  it("drop what's left out: this month's spending, and every budget it was in", () => {
    const data = buildDemoData("2026-10-05");
    const biggest = data.transactions.filter((t) => t.date >= "2026-10-01" && t.amount < 0 && t.category !== "transfer" && t.category !== "income").sort((a, b) => a.amount - b.amount)[0]!;
    const before = analyze(data);
    const after = analyze({ ...data, transactions: applyDetails(data.transactions, { v: 1, lines: { [biggest.id]: { out: true } } }) });
    expect(after.spentMTD).toBe(before.spentMTD + biggest.amount);
    const budget = (a: typeof before) => a.budgets.find((b) => b.category === biggest.category)?.spent;
    if (budget(before) !== undefined) expect(budget(after)).toBe(budget(before)! + biggest.amount);
  });
});
