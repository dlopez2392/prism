// A person's credit cards (cards.ts): usage against the limit, the next
// statement, what paying before it would do, interest and annual fees.

import { describe, expect, it } from "vitest";
import { cardsFor } from "./cards";
import { buildDemoData } from "./demo";
import { tx } from "./test-helpers";
import type { Account } from "./types";

const TODAY = "2026-10-20";
const card = (over: Partial<Account> = {}): Account => ({
  id: "visa",
  institutionId: "bank",
  name: "Rewards Visa",
  mask: "1107",
  kind: "credit",
  balance: -180_000,
  history: [-180_000],
  source: "plaid",
  creditLimit: 500_000,
  ...over,
});

describe("cards", () => {
  it("measures what's owed against the limit, and what paying before the next close would take", () => {
    const c = cardsFor([card({ liability: { dueDate: "2026-11-15", minimumPayment: 3_500, statementBalance: 150_000, apr: 24.49, overdue: false, statementDate: "2026-09-21" } })], [], TODAY);
    const [row] = c.cards;
    expect(row).toMatchObject({ owed: 180_000, limit: 500_000, usage: 0.36, statementDate: "2026-09-21", nextClose: "2026-10-21", dueDate: "2026-11-15" });
    // 36% now: $300 before Oct 21 brings it to 30%.
    expect(row!.payToReach).toEqual({ level: 0.3, amount: 30_000, by: "2026-10-21" });
    expect(c).toMatchObject({ owed: 180_000, limits: 500_000, usage: 0.36 });
  });

  it("aims at 10% once under 30%, and says nothing once under 10%", () => {
    expect(cardsFor([card({ balance: -100_000 })], [], TODAY).cards[0]!.payToReach).toEqual({ level: 0.1, amount: 50_000, by: null });
    expect(cardsFor([card({ balance: -40_000 })], [], TODAY).cards[0]!.payToReach).toBeNull();
    // A card in credit owes nothing, and one without a limit has no usage.
    expect(cardsFor([card({ balance: 2_000 })], [], TODAY).cards[0]).toMatchObject({ owed: 0, usage: 0, payToReach: null });
    expect(cardsFor([card({ creditLimit: undefined })], [], TODAY)).toMatchObject({ usage: null, limits: 0, cards: [{ usage: null, payToReach: null }] });
  });

  it("adds up the interest each card charged, and finds its annual fee", () => {
    const lines = [
      tx("2026-09-21", -3_412, "INTEREST CHARGE ON PURCHASES", "bills", "visa"),
      Object.assign(tx("2026-02-21", -2_100, "Finance charge", "bills", "visa"), {}),
      { ...tx("2025-12-21", -1_900, "PURCHASE", "bills", "visa"), interestCharge: true as const },
      tx("2025-08-01", -5_000, "INTEREST CHARGE", "bills", "visa"),
      tx("2026-03-02", -9_500, "ANNUAL MEMBERSHIP FEE", "bills", "visa"),
      tx("2026-03-10", -4_000, "Interest charge", "bills", "other-card"),
    ];
    const [row] = cardsFor([card()], lines, TODAY).cards;
    expect(row!.interest).toMatchObject({ last12: 3_412 + 2_100 + 1_900, thisYear: 3_412 + 2_100 });
    expect(row!.interest.ids).toHaveLength(3);
    expect(row!.annualFee).toMatchObject({ amount: 9_500, date: "2026-03-02" });
  });

  it("reads the example household's card", () => {
    const d = buildDemoData(TODAY);
    const c = cardsFor(d.accounts, d.transactions, d.today);
    expect(c.cards).toHaveLength(1);
    expect(c.cards[0]).toMatchObject({ name: "Summit Rewards Visa", limit: 1_200_000 });
    expect(c.cards[0]!.statementDate! <= TODAY).toBe(true);
    expect(c.cards[0]!.nextClose! > TODAY).toBe(true);
  });
});
