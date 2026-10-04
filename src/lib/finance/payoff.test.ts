// Paying off what you owe (payoff.ts): the arithmetic month by month, the
// two orders and the roll-over that makes them work, the debts that never
// shrink, and which cards and loans start in the plan.

import { describe, expect, it } from "vitest";
import { buildDemoData } from "./demo";
import { chargedInterest, comparePayoff, debtAccounts, PAYOFF_LIMITS, PAYOFF_MAX_MONTHS, parseRate, payoffOrder, planPayoff, validDebts, type Debt } from "./payoff";
import { tx } from "./test-helpers";
import type { Account } from "./types";

const TODAY = "2026-10-04";
const debt = (id: string, owed: number, apr: number, payment: number): Debt => ({ id, name: id, owed, apr, payment });

describe("one debt, month by month", () => {
  it("charges a twelfth of the yearly rate on what's owed, to the cent, then takes the payment", () => {
    const plan = planPayoff([debt("Card", 30_000, 12, 10_000)], 0, "avalanche", TODAY);
    // 300 → 203 → 105 → 6 in interest; the last payment is only what's left.
    expect(plan.owed).toEqual([30_000, 20_300, 10_503, 608, 0]);
    expect(plan).toMatchObject({ months: 4, debtFree: "2027-02", interest: 614, stuck: [] });
    expect(plan.cleared).toEqual([{ id: "Card", name: "Card", months: 4, month: "2027-02" }]);
  });

  it("rounds each month's interest to the nearest cent", () => {
    // $300.90 at 12% is 300.9 cents of interest: 301.
    expect(planPayoff([debt("Card", 30_090, 12, 40_000)], 0, "minimums", TODAY)).toMatchObject({ months: 1, interest: 301 });
  });

  it("costs nothing extra at no interest, and the extra shortens it", () => {
    expect(planPayoff([debt("Loan from Mom", 100_000, 0, 25_000)], 0, "snowball", TODAY)).toMatchObject({ months: 4, interest: 0 });
    expect(planPayoff([debt("Loan from Mom", 100_000, 0, 25_000)], 25_000, "snowball", TODAY)).toMatchObject({ months: 2, interest: 0 });
    expect(planPayoff([debt("Loan from Mom", 100_000, 0, 25_000)], 25_000, "minimums", TODAY)).toMatchObject({ months: 4 });
  });
});

describe("the two orders", () => {
  // A small loan at a low rate, and a bigger card at a high one.
  const debts = [debt("Card", 300_000, 24, 9_000), debt("Loan", 80_000, 6, 5_000)];

  it("line up by rate or by balance, and break ties the other way, then by name", () => {
    expect(payoffOrder(debts, "avalanche").map((d) => d.id)).toEqual(["Card", "Loan"]);
    expect(payoffOrder(debts, "snowball").map((d) => d.id)).toEqual(["Loan", "Card"]);
    const tied = [debt("B", 1_000, 10, 100), debt("A", 1_000, 10, 100), debt("C", 500, 10, 100), debt("D", 1_000, 20, 100)];
    expect(payoffOrder(tied, "avalanche").map((d) => d.id)).toEqual(["D", "C", "A", "B"]);
    expect(payoffOrder(tied, "snowball").map((d) => d.id)).toEqual(["C", "D", "A", "B"]);
  });

  it("highest rate first pays the least interest; smallest balance first clears one soonest", () => {
    const { avalanche, snowball, minimums, same } = comparePayoff(debts, 20_000, TODAY);
    expect(same).toBe(false);
    expect(avalanche.cleared.map((c) => c.id)).toEqual(["Card", "Loan"]);
    expect(snowball.cleared.map((c) => c.id)).toEqual(["Loan", "Card"]);
    expect(avalanche.interest).toBeLessThan(snowball.interest);
    expect(snowball.cleared[0]!.months!).toBeLessThan(avalanche.cleared[0]!.months!);
    // The extra and the roll-over beat paying only what each asks, by years.
    expect(minimums.months! - avalanche.months!).toBeGreaterThan(24);
    expect(minimums.interest).toBeGreaterThan(avalanche.interest);
  });

  it("rolls a cleared debt's payment into the next, so the extra keeps growing", () => {
    const two = [debt("Small", 10_000, 0, 5_000), debt("Big", 100_000, 0, 5_000)];
    const plan = planPayoff(two, 0, "snowball", TODAY);
    // Small is gone in month 2; from month 3 Big gets both payments.
    expect(plan.owed).toEqual([110_000, 100_000, 90_000, 80_000, 70_000, 60_000, 50_000, 40_000, 30_000, 20_000, 10_000, 0]);
    expect(plan.cleared.map((c) => [c.id, c.months])).toEqual([
      ["Small", 2],
      ["Big", 11],
    ]);
    // Without the roll-over, Big takes twenty months.
    expect(planPayoff(two, 0, "minimums", TODAY).cleared.map((c) => [c.id, c.months])).toEqual([
      ["Small", 2],
      ["Big", 20],
    ]);
  });

  it("says when both orders are the same line", () => {
    expect(comparePayoff([debt("Card", 50_000, 24, 5_000), debt("Loan", 900_000, 6, 20_000)], 0, TODAY).same).toBe(true);
  });
});

describe("a debt that never shrinks", () => {
  it("is stuck when its own payment doesn't cover its interest, while the others still clear", () => {
    // $5,000 at 24% charges $100 a month: a $90 payment loses ground.
    const plan = planPayoff([debt("Card", 500_000, 24, 9_000), debt("Loan", 20_000, 0, 10_000)], 0, "minimums", TODAY);
    expect(plan).toMatchObject({ months: null, debtFree: null, stuck: ["Card"] });
    expect(plan.cleared).toEqual([
      { id: "Loan", name: "Loan", months: 2, month: "2026-12" },
      { id: "Card", name: "Card", months: null, month: null },
    ]);
    // It keeps growing ($5,000 → $5,010 → $5,020.20) while the loan is paid off, and the plan stops once only it is left.
    expect(plan.owed).toEqual([520_000, 511_000, 502_020]);
    expect(plan.interest).toBe(10_000 + 10_020);
    // A payment that only matches its interest never shrinks it either; one cent over does.
    expect(planPayoff([debt("Card", 500_000, 24, 10_000)], 0, "minimums", TODAY).stuck).toEqual(["Card"]);
    expect(planPayoff([debt("Card", 500_000, 24, 10_001)], 0, "minimums", TODAY).stuck).toEqual([]);
  });

  it("stops a plan whose payments together don't cover the month's interest", () => {
    const plan = planPayoff([debt("Card", 500_000, 24, 6_000), debt("Store card", 100_000, 30, 2_000)], 1_000, "avalanche", TODAY);
    // $100 + $25 of interest against $90 paid.
    expect(plan).toMatchObject({ months: null, debtFree: null, interest: 12_500, stuck: ["Store card", "Card"] });
    expect(plan.owed).toEqual([600_000]);
    // A pot that only matches the interest gets nowhere too.
    expect(planPayoff([debt("Card", 500_000, 24, 10_000)], 0, "avalanche", TODAY)).toMatchObject({ months: null, stuck: ["Card"], owed: [500_000] });
    // In an order, a payment that doesn't cover its own interest is fine while the pot covers everything.
    expect(planPayoff([debt("Card", 500_000, 24, 9_000)], 2_000, "avalanche", TODAY).months).not.toBeNull();
  });

  it("stops at fifty years", () => {
    // Barely over its interest: it would take centuries.
    const plan = planPayoff([debt("Loan", 1_000_000_000, 12, 10_000_001)], 0, "minimums", TODAY);
    expect(plan.months).toBeNull();
    expect(PAYOFF_MAX_MONTHS).toBe(600);
    expect(plan.owed).toHaveLength(601);
    expect(plan.stuck).toEqual([]);
  });
});

describe("what a person types", () => {
  it("reads a rate with or without the percent sign, up to 100", () => {
    expect(["6.9", " 24.99% ", "0", "100", "5.125 %"].map(parseRate)).toEqual([6.9, 24.99, 0, 100, 5.125]);
    expect(["", "abc", "-3", "100.01", "1,5", "6.9.1", "1234", "5.1234"].map(parseRate)).toEqual([null, null, null, null, null, null, null, null]);
  });

  it("is kept only when every debt is whole and within limits", () => {
    const good = { id: "a", name: "Card", owed: 100_000, apr: 24.99, payment: 3_500 };
    expect(validDebts([good])).toEqual([good]);
    expect(validDebts([])).toBeNull();
    expect(validDebts(Array.from({ length: PAYOFF_LIMITS.debts + 1 }, (_, i) => ({ ...good, id: `d${i}` })))).toBeNull();
    for (const bad of [
      { ...good, owed: 0 },
      { ...good, owed: 10.5 },
      { ...good, owed: PAYOFF_LIMITS.owed + 1 },
      { ...good, apr: -1 },
      { ...good, apr: PAYOFF_LIMITS.apr + 0.01 },
      { ...good, apr: Number.NaN },
      { ...good, payment: 0 },
      { ...good, payment: PAYOFF_LIMITS.payment + 1 },
      { ...good, id: "" },
      { ...good, name: 7 },
    ]) {
      expect(validDebts([bad])).toBeNull();
    }
    expect(validDebts([good, { ...good }])).toBeNull();
    expect(validDebts([{ ...good, owed: PAYOFF_LIMITS.owed, payment: PAYOFF_LIMITS.payment, apr: PAYOFF_LIMITS.apr }])).not.toBeNull();
  });
});

describe("which cards and loans start in the plan", () => {
  const account = (over: Partial<Account>): Account => ({ id: "x", institutionId: "i", name: "X", mask: null, kind: "credit", balance: -100_000, history: [], source: "plaid", ...over });

  it("is every loan, and a card only when it charged interest in the last two statements", () => {
    const accounts = [
      account({ id: "card", name: "Visa", balance: -250_000, liability: { dueDate: null, minimumPayment: 7_500, statementBalance: null, apr: 27.24, overdue: false } }),
      account({ id: "paid", name: "Amex", balance: -80_000 }),
      account({ id: "car", name: "Car loan", kind: "loan", balance: -1_200_000 }),
      account({ id: "credit", name: "Refunded", balance: 2_000 }),
      account({ id: "zero", name: "Paid off", balance: 0 }),
      account({ id: "chk", name: "Checking", kind: "checking", balance: -500 }),
    ];
    const txns = [{ ...tx("2026-09-08", -5_312, "INTEREST CHARGE ON PURCHASES", "other", "card") }, tx("2026-09-10", -4_000, "Fuel Stop", "transport", "paid")];
    expect(debtAccounts(accounts, txns, TODAY)).toEqual([
      { id: "car", name: "Car loan", mask: null, kind: "loan", owed: 1_200_000, apr: null, payment: null, carried: true },
      { id: "card", name: "Visa", mask: null, kind: "credit", owed: 250_000, apr: 27.24, payment: 7_500, carried: true },
      { id: "paid", name: "Amex", mask: null, kind: "credit", owed: 80_000, apr: null, payment: null, carried: false },
    ]);
  });

  it("knows interest from the bank's own category, or the words on the line, within 65 days", () => {
    const charge = (date: string, merchant: string, flag = false) => [{ ...tx(date, -1_000, merchant, "other", "card"), ...(flag ? { interestCharge: true as const } : {}) }];
    expect(chargedInterest("card", charge("2026-08-01", "Monthly charge", true), TODAY)).toBe(true);
    // 65 days back is July 31.
    expect(chargedInterest("card", charge("2026-07-31", "Purchase interest"), TODAY)).toBe(true);
    expect(chargedInterest("card", charge("2026-07-30", "Purchase interest"), TODAY)).toBe(false);
    expect(chargedInterest("card", charge("2026-09-01", "Interest Charged"), TODAY)).toBe(true);
    expect(chargedInterest("card", charge("2026-09-01", "Finance charge"), TODAY)).toBe(true);
    // Interest earned on savings, a lookalike name, and another account's charge aren't.
    expect(chargedInterest("card", [{ ...tx("2026-09-01", 1_000, "Interest charge reversal", "other", "card") }], TODAY)).toBe(false);
    expect(chargedInterest("card", charge("2026-09-01", "Interesting Books"), TODAY)).toBe(false);
    expect(chargedInterest("other", charge("2026-09-01", "Purchase interest"), TODAY)).toBe(false);
  });

  it("in the example household: the two loans, with their lenders' terms, and not the card paid off each month", () => {
    const data = buildDemoData("2026-09-27");
    const rows = debtAccounts(data.accounts, data.transactions, data.today);
    expect(rows.map((r) => [r.name, r.carried, r.apr, r.payment])).toEqual([
      ["Auto loan", true, 6.9, 38_900],
      ["Student loan", true, 5.05, 21_000],
      ["Summit Rewards Visa", false, 24.49, 3_500],
    ]);
    // The two orders differ: the car's rate is higher, the student loan's balance smaller.
    const debts = rows.filter((r) => r.carried).map((r) => ({ id: r.id, name: r.name, owed: r.owed, apr: r.apr!, payment: r.payment! }));
    const c = comparePayoff(debts, 20_000, data.today);
    expect([c.avalanche.cleared[0]!.name, c.snowball.cleared[0]!.name, c.same]).toEqual(["Auto loan", "Student loan", false]);
  });
});
