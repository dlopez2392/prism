// Cards and loans by what they ask for next (debts.ts): the Future list, the
// Net worth line and a connected app all read these same answers.

import { describe, expect, it } from "vitest";
import { dueIn, paymentsDue, rateText, statementText, termsLine, withLenderTerms } from "./debts";
import { buildDemoData } from "./demo";
import { streamEvents } from "./forecast";
import { analyze } from "./model";
import type { RecurringStream } from "./recurring";
import type { Account, Transaction } from "./types";

const TODAY = "2026-09-30";
const acc = (id: string, kind: Account["kind"], liability?: Account["liability"]): Account => ({ id, institutionId: "i", name: id, mask: null, kind, balance: -1, history: [-1], source: "plaid", ...(liability ? { liability } : {}) });
const terms = (dueDate: string | null, over: Partial<NonNullable<Account["liability"]>> = {}) => ({ dueDate, minimumPayment: 3_500, statementBalance: 124_000, apr: 24.99, overdue: false, ...over });

describe("payments due", () => {
  it("are the cards and loans due from today to the window's end, soonest first", () => {
    const accounts = [acc("late", "loan", terms("2026-11-20")), acc("b", "credit", terms("2026-10-14")), acc("a", "loan", terms("2026-10-14")), acc("today", "credit", terms(TODAY)), acc("none", "credit", terms(null)), acc("chk", "checking")];
    expect(paymentsDue(accounts, TODAY).map((p) => p.account.id)).toEqual(["today", "a", "b"]);
    expect(paymentsDue(accounts, TODAY, 60).map((p) => p.account.id)).toEqual(["today", "a", "b", "late"]);
  });

  it("read in plain words", () => {
    expect(dueIn(TODAY, TODAY)).toBe("today");
    expect(dueIn("2026-10-01", TODAY)).toBe("tomorrow");
    expect(dueIn("2026-10-14", TODAY)).toBe("in 14 days");
    expect(rateText(24.99, "credit")).toBe("24.99% APR");
    expect(rateText(6.9, "loan")).toBe("6.9% interest");
    expect(rateText(5.0500001, "loan")).toBe("5.05% interest");
    expect(termsLine(acc("c", "credit", terms("2026-10-14")))).toBe("Due Oct 14 · $35.00 minimum · 24.99% APR");
    // Only what the lender said.
    expect(termsLine(acc("c", "loan", terms(null, { minimumPayment: null, apr: 6.9 })))).toBe("6.9% interest");
    expect(termsLine(acc("c", "credit", terms(null, { minimumPayment: null, apr: null })))).toBeNull();
    expect(termsLine(acc("c", "credit"))).toBeNull();
    expect(statementText(terms(null))).toBe("Statement $1,240");
    expect(statementText(terms(null, { statementBalance: null }))).toBeNull();
  });

  it("show in the demo household, so the feature can be seen before anything is linked", () => {
    const demo = buildDemoData(TODAY);
    // The same days and amounts the demo pays them on: loans on the 14th and 25th, the card on the 18th.
    expect(paymentsDue(demo.accounts, TODAY).map((p) => [p.account.name, p.liability.dueDate, p.liability.minimumPayment])).toEqual([
      ["Auto loan", "2026-10-14", 38_900],
      ["Summit Rewards Visa", "2026-10-18", 3_500],
      ["Student loan", "2026-10-25", 21_000],
    ]);
  });
});

describe("the payment that pays a card", () => {
  const tx = (id: string, accountId: string, date: string, amount: number): Transaction => ({ id, accountId, date, amount, merchant: accountId === "chk" ? "CARD AUTOPAY" : "Payment — thank you", category: "transfer", pending: false });
  const stream = (over: Partial<RecurringStream> = {}): RecurringStream => ({
    id: "chk|card autopay|out",
    merchant: "CARD AUTOPAY",
    accountId: "chk",
    category: "transfer",
    kind: "transfer",
    cadence: "monthly",
    amount: -150_000,
    variable: true,
    lastDate: "2026-09-18",
    nextDate: "2026-10-18",
    occurrences: 3,
    priceChange: null,
    transactionIds: ["o7", "o8", "o9"],
    ...over,
  });
  // Checking paid the card on the 18th; the card saw each payment arrive a day later.
  const txns = [
    tx("o7", "chk", "2026-07-18", -140_000), tx("i7", "card", "2026-07-19", 140_000),
    tx("o8", "chk", "2026-08-18", -160_000), tx("i8", "card", "2026-08-19", 160_000),
    tx("o9", "chk", "2026-09-18", -150_000), tx("i9", "card", "2026-09-19", 150_000),
  ];
  const card = (liability: Account["liability"]) => ({ ...acc("card", "credit", liability) });

  it("is found from both sides of each payment, and takes the lender's date and statement", () => {
    const [s] = withLenderTerms([stream()], [card(terms("2026-10-20", { statementBalance: 131_000, minimumPayment: 3_500 }))], txns, TODAY);
    expect(s!.lender).toEqual({ accountId: "card", dueDate: "2026-10-20", amount: -131_000 });
  });

  it("takes the minimum instead for someone who pays the minimum", () => {
    const small = [stream({ amount: -3_500, transactionIds: ["m1", "m2", "m3"] })];
    const paid = [1, 2, 3].flatMap((n) => [tx(`m${n}`, "chk", `2026-0${6 + n}-18`, -3_500), tx(`p${n}`, "card", `2026-0${6 + n}-18`, 3_500)]);
    expect(withLenderTerms(small, [card(terms("2026-10-20", { statementBalance: 131_000, minimumPayment: 3_500 }))], paid, TODAY)[0]!.lender?.amount).toBe(-3_500);
  });

  it("is never guessed: a same-sized charge that the card never received stays an estimate", () => {
    const elsewhere = txns.filter((t) => t.accountId === "chk");
    const streams = [stream()];
    expect(withLenderTerms(streams, [card(terms("2026-10-20"))], elsewhere, TODAY)[0]).not.toHaveProperty("lender");
    // One matching payment isn't a pattern.
    expect(withLenderTerms(streams, [card(terms("2026-10-20"))], [...elsewhere, txns[1]!], TODAY)[0]).not.toHaveProperty("lender");
    // And without lender terms, nothing is touched at all.
    expect(withLenderTerms(streams, [acc("card", "credit")], txns, TODAY)).toBe(streams);
    expect(withLenderTerms(streams, [card(terms(null))], txns, TODAY)).toBe(streams);
  });

  it("replaces only the estimate it stands for in the forecast; later ones stay estimates", () => {
    const s = { ...stream(), lender: { accountId: "card", dueDate: "2026-10-20", amount: -131_000 } };
    const events = streamEvents(s, "2026-10-01", "2026-11-29");
    expect(events.map((e) => [e.date, e.amount, e.variable, e.fromLender ?? false]).sort()).toEqual([
      ["2026-10-20", -131_000, false, true],
      ["2026-11-18", -150_000, true, false],
    ]);
    // A due date past the window's end changes nothing: the estimate inside it stands.
    expect(streamEvents(s, "2026-10-01", "2026-10-19").map((e) => [e.date, e.amount, e.fromLender ?? false])).toEqual([["2026-10-18", -150_000, false]]);
  });

  it("puts the demo card's statement, not an estimate, on Future", () => {
    const demo = buildDemoData(TODAY);
    const a = analyze(demo);
    const card = demo.accounts.find((x) => x.name === "Summit Rewards Visa")!;
    const payments = a.forecast!.events.filter((e) => e.merchant === "Summit Card payment");
    expect(payments[0]).toMatchObject({ date: card.liability!.dueDate, amount: -card.liability!.statementBalance!, variable: false, fromLender: true });
    expect(payments.filter((e) => e.fromLender)).toHaveLength(1);
  });
});
