// The Household view (household.ts): exactly what each member shared, whose
// it is, and nothing that could let one person's money pass for another's.

import { describe, expect, it } from "vitest";
import { householdData, narrowTo, type MemberMoney } from "./household";
import type { Account, FinanceData, Institution, Transaction } from "./types";

const inst = (id: string, name: string): Institution => ({ id, name, health: "healthy", lastSyncedAt: null, source: "plaid" });
const acct = (id: string, institutionId: string, name: string, balance: number): Account => ({ id, institutionId, name, mask: null, kind: "checking", balance, history: [balance], source: "plaid" });
const tx = (id: string, accountId: string, date: string, amount: number): Transaction => ({ id, accountId, date, amount, merchant: "Shop", category: "food", pending: false });

const mine: FinanceData = {
  source: "plaid",
  today: "2026-09-29",
  household: { name: "Dana's household", firstName: "Dana" },
  institutions: [inst("item-a", "Northwind Bank"), inst("item-b", "Secret Bank")],
  accounts: [acct("joint", "item-a", "Joint Checking", 500_00), acct("mine-only", "item-a", "My Savings", 9_000_00), acct("secret", "item-b", "Rainy day", 1)],
  transactions: [tx("t1", "joint", "2026-09-02", -40_00), tx("t2", "mine-only", "2026-09-03", -1_00), tx("t3", "secret", "2026-09-04", -2_00)],
  budgets: [{ category: "food", limit: 500_00 }],
  goals: [{ id: "g", name: "Trip", emoji: "🗾", target: 1, saved: 0, monthlyContribution: 0, targetDate: "2027-01-01", colorSlot: 1, history: [0] }],
  holdings: [
    { accountId: "joint", symbol: "X", name: "X", value: 1, costBasis: 1, assetClass: "Cash" },
    { accountId: "secret", symbol: "Y", name: "Y", value: 2, costBasis: 2, assetClass: "Cash" },
  ],
  credit: { score: 700, provider: "p", history: [700], factors: [] },
};

const sam: MemberMoney = {
  userId: "u-sam",
  name: "Sam",
  institutions: [inst("item-s", "Summit Card"), { ...inst("manual", "Added by you"), source: "manual" }],
  accounts: [acct("card", "item-s", "Rewards Visa", -300_00), { ...acct("manual-our-house", "manual", "Our house", 350_000_00), kind: "property", source: "manual" }],
  transactions: [tx("t9", "card", "2026-09-01", -12_00)],
};

describe("narrowing to what's shared", () => {
  it("keeps only the shared accounts, their transactions, and the institutions they sit at", () => {
    const n = narrowTo(mine, new Set(["joint"]));
    expect(n.accounts.map((a) => a.id)).toEqual(["joint"]);
    expect(n.transactions.map((t) => t.id)).toEqual(["t1"]);
    expect(n.institutions.map((i) => i.name)).toEqual(["Northwind Bank"]);
  });
});

describe("the Household view", () => {
  const h = householdData(mine, new Set(["joint"]), "You", [sam]);

  it("shows my shared account and everything Sam shared, and nothing I kept private", () => {
    expect(h.accounts.map((a) => a.name)).toEqual(["Joint Checking", "Rewards Visa", "Our house"]);
    expect(JSON.stringify(h)).not.toContain("My Savings");
    expect(JSON.stringify(h)).not.toContain("Secret Bank");
    expect(h.transactions.map((t) => t.id)).toEqual(["u-sam:t9", "t1"]);
  });

  it("says whose each one is", () => {
    expect(h.institutions.map((i) => i.name)).toEqual(["Northwind Bank · You", "Summit Card · Sam", "Added by you · Sam"]);
  });

  it("keeps another member's ids apart from mine, so the same name for two people's things never collides", () => {
    const alsoMine = householdData({ ...mine, accounts: [...mine.accounts, { ...acct("manual-our-house", "manual", "Our house", 1), source: "manual" }] }, new Set(["manual-our-house"]), "You", [sam]);
    const houses = alsoMine.accounts.filter((a) => a.name === "Our house");
    expect(new Set(houses.map((a) => a.id)).size).toBe(2);
    const card = h.accounts.find((a) => a.name === "Rewards Visa")!;
    expect(h.transactions.filter((t) => t.accountId === card.id).map((t) => t.id)).toEqual(["u-sam:t9"]);
  });

  it("carries no one's budgets, goals or credit score, and only holdings of accounts I shared", () => {
    expect(h.budgets).toEqual([]);
    expect(h.goals).toEqual([]);
    expect(h.credit).toBeNull();
    expect(h.holdings.map((x) => x.symbol)).toEqual(["X"]);
  });

  it("is empty, not the example household, when nothing is shared yet", () => {
    const none = householdData(mine, new Set(), "You", []);
    expect(none).toMatchObject({ source: "plaid", accounts: [], transactions: [], institutions: [] });
  });
});
