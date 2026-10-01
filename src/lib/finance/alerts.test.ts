// What's worth a heads-up (alerts.ts): a bank that has stopped updating or
// soon will, a bill before payday the account won't cover, a price that just
// went up; each with an id for its occasion and a wording without amounts.

import { describe, expect, it } from "vitest";
import { alertsFor } from "./alerts";
import { analyze } from "./model";
import { monthly, tx } from "./test-helpers";
import type { Account, FinanceData, Institution, Transaction } from "./types";

const TODAY = "2026-09-25"; // a Friday
const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
// Every other Friday; the next is Oct 2, the day after rent.
const PAYDAYS = ["2026-04-17", "2026-05-01", "2026-05-15", "2026-05-29", "2026-06-12", "2026-06-26", "2026-07-10", "2026-07-24", "2026-08-07", "2026-08-21", "2026-09-04", "2026-09-18"];

const checking = (balance: number): Account => ({ id: "chk", institutionId: "bank1", name: "Everyday Checking", mask: "1234", kind: "checking", balance, history: [balance], source: "plaid" });
const bank = (over: Partial<Institution> = {}): Institution => ({ id: "bank1", name: "First Bank", health: "healthy", lastSyncedAt: "2026-09-25T12:00:00Z", source: "plaid", ...over });

function data(txns: Transaction[], { balance = 50_000, institutions = [bank()] }: { balance?: number; institutions?: Institution[] } = {}): FinanceData {
  return {
    source: "plaid",
    today: TODAY,
    household: { name: "Test", firstName: "Sam" },
    institutions,
    accounts: [checking(balance)],
    transactions: txns.sort((a, b) => (a.date < b.date ? -1 : 1)),
    budgets: [],
    goals: [],
    holdings: [],
    credit: null,
  };
}

const pay = () => PAYDAYS.map((d) => tx(d, 200_000, "Acme Payroll", "income"));
const rent = () => monthly(MONTHS, 1, -180_000, "Oak Street Rent", "housing");
const alerts = (d: FinanceData) => alertsFor(analyze(d));

describe("alerts", () => {
  it("says nothing when nothing needs saying", () => {
    expect(alerts(data([...pay(), ...rent()], { balance: 400_000 }))).toEqual([]);
  });

  it("warns that a bill before payday won't be covered, once for that bill on that day", () => {
    const [bill] = alerts(data([...pay(), ...rent()], { balance: 50_000 }));
    expect(bill).toMatchObject({
      id: "bill-short:oak street rent:2026-10-01",
      kind: "bill-short",
      urgent: true,
      on: "2026-10-01",
      href: "/future",
      title: "Oak Street Rent ($1,800) may not be covered on Thu, Oct 1",
    });
    expect(bill!.detail).toMatch(/before your paycheck on Fri, Oct 2, and Everyday Checking is on track to be \$1,300 short after it/);
    // The quiet wording carries no amount at all.
    expect(`${bill!.quiet.title} ${bill!.quiet.detail}`).not.toMatch(/\$|\d,\d{3}/);
  });

  it("counts a bill due on payday only if it's short even with the paycheck in, and none after payday", () => {
    // Rent on the 2nd, the day the $2,000 paycheck lands: $500 + $2,000 covers $1,800.
    const onPayday = (amount: number) => data([...pay(), ...monthly(MONTHS, 2, amount, "Oak Street Rent", "housing")], { balance: 50_000 });
    expect(alerts(onPayday(-180_000)).filter((x) => x.kind === "bill-short")).toEqual([]);
    // $3,000 isn't covered even with it.
    const [short] = alerts(onPayday(-300_000)).filter((x) => x.kind === "bill-short");
    expect(short).toMatchObject({ id: "bill-short:oak street rent:2026-10-02", on: "2026-10-02" });
    expect(short!.detail).toMatch(/^It's due on payday, and even with your paycheck in, Everyday Checking is on track to be \$500 short after it\./);
    // A bill after payday is the next pay period's business.
    expect(alerts(data([...pay(), ...monthly(MONTHS, 5, -300_000, "Oak Street Rent", "housing")], { balance: 50_000 })).filter((x) => x.kind === "bill-short")).toEqual([]);
  });

  it("names a bank that needs a sign-in, or will stop updating, as urgent", () => {
    const [signIn] = alerts(data([], { institutions: [bank({ health: "needs_attention", signInAgain: true })] }));
    expect(signIn).toMatchObject({ id: "bank:bank1:sign-in", kind: "bank", title: "First Bank needs you to sign in again", urgent: true, href: "/connections" });
    expect(signIn!.detail).toMatch(/It last updated Sep 25\./);

    const [ending] = alerts(data([], { institutions: [bank({ disconnectsAt: "2026-10-02T13:25:17.766Z" })] }));
    expect(ending).toMatchObject({ id: "bank:bank1:disconnect:2026-10-02", title: "First Bank stops updating on Fri, Oct 2", on: "2026-10-02", urgent: true });
    // An imported file or a hand-entered item is never a bank to sign in to.
    expect(alerts(data([], { institutions: [bank({ source: "import", signInAgain: true })] }))).toEqual([]);
  });

  it("notices a recurring charge that just went up, and only while that's news", () => {
    const charges = (months: string[]) => monthly(months, 22, [-1_549, -1_549, -1_549, -1_549, -1_799, -1_799], "Streamflix", "fun");
    const [rise] = alerts(data([...pay(), ...charges(MONTHS)], { balance: 400_000 }));
    expect(rise).toMatchObject({ kind: "price-rise", title: "Streamflix went up to $17.99", urgent: false, href: "/cash-flow" });
    expect(rise!.detail).toBe("It was $15.49. That's $30 more a year, if you still use it.");
    expect(rise!.id).toMatch(/^price-rise:.+:1799$/);
    expect(`${rise!.quiet.title} ${rise!.quiet.detail}`).not.toContain("$");
    // A rise 65 days ago (July 22) is still a price change to the insights, but no longer news worth an alert.
    const july = monthly(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"], 22, [-1_549, -1_549, -1_549, -1_549, -1_799, -1_799, -1_799], "Streamflix", "fun");
    const a = analyze(data([...pay(), ...july], { balance: 400_000 }));
    expect(a.streams.find((s) => s.merchant === "Streamflix")!.priceChange).toMatchObject({ date: "2026-07-22" });
    expect(alertsFor(a).filter((x) => x.kind === "price-rise")).toEqual([]);
    // A price that went down is good news, not an alert.
    const cheaper = monthly(MONTHS, 22, [-1_799, -1_799, -1_799, -1_799, -1_549, -1_549], "Streamflix", "fun");
    expect(alerts(data([...pay(), ...cheaper], { balance: 400_000 }))).toEqual([]);
  });

  it("puts the urgent first", () => {
    const charges = monthly(MONTHS, 22, [-1_549, -1_549, -1_549, -1_549, -1_799, -1_799], "Streamflix", "fun");
    const kinds = alerts(data([...pay(), ...rent(), ...charges], { balance: 50_000, institutions: [bank({ disconnectsAt: "2026-10-02T00:00:00Z" })] })).map((x) => x.kind);
    expect(kinds).toEqual(["bank", "bill-short", "price-rise"]);
  });
});
