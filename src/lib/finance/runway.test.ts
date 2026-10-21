// How long could you last (runway.ts): cash on hand against what a month
// costs, everything and the essentials, with loans counted once.

import { describe, expect, it } from "vitest";
import { buildDemoData } from "./demo";
import { runwayFor } from "./runway";
import { tx } from "./test-helpers";
import type { Account } from "./types";

const TODAY = "2026-10-21";

const account = (id: string, kind: Account["kind"], balance: number, extra: Partial<Account> = {}): Account =>
  ({ id, institutionId: "bank", name: id, mask: null, kind, balance, history: [], ...extra }) as Account;

/** The same spending in each of July, August and September: $1,500 rent, $600 food, $400 fun. */
function months() {
  return ["2026-07", "2026-08", "2026-09"].flatMap((m) => [
    tx(`${m}-01`, -150_000, "Rent", "housing"),
    tx(`${m}-10`, -60_000, "Grocer", "food"),
    tx(`${m}-20`, -40_000, "Cinema", "fun"),
  ]);
}

describe("runway", () => {
  it("divides the cash on hand by what a month costs, all of it and the essentials", () => {
    const r = runwayFor([account("chk", "checking", 500_000), account("sav", "savings", 1_000_000), account("card", "credit", -80_000)], months(), TODAY)!;
    expect(r).toMatchObject({ cash: 1_500_000, monthsMeasured: 3, usual: 250_000, essentials: 210_000, loans: [] });
    expect(r.months.usual).toBe(6);
    expect(r.months.essentials).toBeCloseTo(7.14, 2);
    expect(r.months.withInvestments).toBeNull();
    expect(r.essentialParts).toEqual([
      { category: "housing", amount: 150_000 },
      { category: "food", amount: 60_000 },
    ]);
    expect(r.until.usual).toBe("2027-04-21");
  });

  it("counts brokerage and crypto in a second figure, never retirement", () => {
    const r = runwayFor(
      [account("chk", "checking", 420_000), account("brk", "investment", 1_680_000), account("btc", "crypto", 0), account("ira", "retirement", 9_000_000)],
      months(),
      TODAY,
    )!;
    expect(r.investments).toBe(1_680_000);
    expect(r.months.essentials).toBe(2);
    expect(r.months.withInvestments).toBe(10);
  });

  it("adds a loan the bank files as a transfer, but not one already paid as a bill", () => {
    const car = account("car", "loan", -1_200_000, { liability: { dueDate: "2026-11-14", minimumPayment: 38_900, statementBalance: null, apr: 6.9, overdue: false } } as Partial<Account>);
    const student = account("student", "loan", -800_000, { liability: { dueDate: "2026-10-25", minimumPayment: 21_000, statementBalance: null, apr: 5, overdue: false } } as Partial<Account>);
    const txns = [...months(), tx("2026-09-25", -21_000, "Federal student loan payment", "bills"), tx("2026-09-14", -38_900, "HARBOR AUTO PMT", "transfer")];
    const r = runwayFor([account("chk", "checking", 1_000_000), car, student], txns, TODAY)!;
    expect(r.loans).toEqual([{ name: "car", amount: 38_900 }]);
    expect(r.usual).toBe(250_000 + 7_000 + 38_900);
  });

  it("measures only whole months, and says nothing without one", () => {
    // History that starts mid-August: only September is whole.
    const partial = [tx("2026-08-17", -30_000, "Grocer", "food"), tx("2026-09-05", -90_000, "Grocer", "food")];
    expect(runwayFor([account("chk", "checking", 180_000)], partial, TODAY)).toMatchObject({ monthsMeasured: 1, usual: 90_000, months: { usual: 2 } });
    expect(runwayFor([account("chk", "checking", 180_000)], [tx("2026-10-05", -9_000, "Grocer", "food")], TODAY)).toBeNull();
  });

  it("never counts less than nothing when checking is overdrawn", () => {
    expect(runwayFor([account("chk", "checking", -5_000)], months(), TODAY)!.months.usual).toBe(0);
  });

  it("gives the example household a cushion", () => {
    const data = buildDemoData(TODAY);
    const r = runwayFor(data.accounts, data.transactions, TODAY)!;
    expect(r.monthsMeasured).toBe(3);
    expect(r.months.essentials).toBeGreaterThan(r.months.usual);
    expect(r.months.withInvestments!).toBeGreaterThan(r.months.essentials);
  });
});
