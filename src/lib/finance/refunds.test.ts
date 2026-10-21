// Money on its way back (refunds.ts): refunds found come back, late ones,
// friends who owe, and money that may be owed but wasn't asked for.

import { describe, expect, it } from "vitest";
import { validDetails, withRefundMark, NO_DETAILS, type RefundMark } from "./details";
import { generateInsights } from "./insights";
import { refundKindOf, refundsFor } from "./refunds";
import { tx } from "./test-helpers";

const TODAY = "2026-10-21";

const mark = (t: { merchant: string; date: string; amount: number }, asked: string, extra: Partial<RefundMark> = {}): RefundMark => ({
  name: t.merchant,
  date: t.date,
  amount: -t.amount,
  kind: "return",
  asked,
  ...extra,
});

describe("refunds", () => {
  it("finds a return come back from the same shop, and keeps waiting on one that hasn't", () => {
    const shoes = tx("2026-09-20", -12_000, "NIKE.COM", "shopping", "card");
    const lamp = tx("2026-10-12", -6_499, "Target", "shopping", "card");
    const back = tx("2026-10-02", 12_000, "NIKE.COM", "shopping", "card");
    const r = refundsFor([shoes, lamp, back], { [shoes.id]: mark(shoes, "2026-09-24"), [lamp.id]: mark(lamp, "2026-10-14") }, null, TODAY);
    expect(r.back).toEqual([{ id: shoes.id, name: "NIKE.COM", amount: 12_000, kind: "return", on: "2026-10-02", via: { id: back.id, date: "2026-10-02" } }]);
    expect(r.waiting).toEqual([{ id: lamp.id, name: "Target", date: "2026-10-12", amount: 6_499, kind: "return", asked: "2026-10-14", due: "2026-10-28", late: 0 }]);
    expect(r).toMatchObject({ waitingTotal: 6_499, late: 0, backThisYear: 12_000 });
  });

  it("says a refund is late past its kind's usual wait, and the insight says so", () => {
    const fee = { ...tx("2026-09-25", -3_500, "Overdraft Item Fee", "other"), bankFee: "overdraft" as const };
    const r = refundsFor([fee], { [fee.id]: mark(fee, "2026-09-26", { kind: "fee" }) }, null, TODAY);
    expect(r.waiting[0]).toMatchObject({ due: "2026-10-06", late: 15 });
    expect(r.late).toBe(1);
    const insights = generateInsights({ txns: [fee], today: TODAY, budgets: [], streams: [], flows: [], refunds: r });
    expect(insights.find((i) => i.id === "refunds-late")).toMatchObject({ title: "Your $35.00 refund from Overdraft Item Fee is late", evidence: [fee.id] });
  });

  it("takes a fee's reversal in the same account by its words, and each line of money in pays back one refund", () => {
    const a = { ...tx("2026-10-01", -3_500, "OD FEE", "other"), bankFee: "overdraft" as const };
    const b = { ...tx("2026-10-03", -3_500, "OD FEE", "other"), bankFee: "overdraft" as const };
    const reversal = tx("2026-10-08", 3_500, "COURTESY REFUND", "other");
    const elsewhere = tx("2026-10-09", 3_500, "COURTESY REFUND", "other", "savings");
    const r = refundsFor([a, b, reversal, elsewhere], { [a.id]: mark(a, "2026-10-02", { kind: "fee" }), [b.id]: mark(b, "2026-10-04", { kind: "fee" }) }, null, TODAY);
    // The oldest fee takes the reversal; the other account's line isn't this account's refund.
    expect(r.back.map((x) => x.id)).toEqual([a.id]);
    expect(r.waiting.map((x) => x.id)).toEqual([b.id]);
  });

  it("never takes money in of another amount, from another shop, or before the purchase", () => {
    const tv = tx("2026-10-05", -49_999, "Best Buy", "shopping", "card");
    const lines = [tv, tx("2026-10-10", 40_000, "Best Buy", "shopping", "card"), tx("2026-10-10", 49_999, "Paycheck", "income"), tx("2026-10-01", 49_999, "Best Buy", "shopping", "card")];
    expect(refundsFor(lines, { [tv.id]: mark(tv, "2026-10-06") }, null, TODAY).waiting.map((w) => w.id)).toEqual([tv.id]);
  });

  it("counts one the person said came back another way, on the day they said", () => {
    const dress = tx("2026-08-02", -8_000, "Zara", "shopping", "card");
    const r = refundsFor([dress], { [dress.id]: mark(dress, "2026-08-03", { got: "2026-08-20" }) }, null, TODAY);
    expect(r.back).toEqual([{ id: dress.id, name: "Zara", amount: 8_000, kind: "return", on: "2026-08-20", via: null }]);
    expect(r.waiting).toEqual([]);
  });

  it("keeps a refund whose purchase is older than the history held", () => {
    const r = refundsFor([], { gone: { name: "REI", date: "2026-06-01", amount: 15_000, kind: "return", asked: "2026-06-02" } }, null, TODAY);
    expect(r.waiting.map((w) => [w.id, w.name])).toEqual([["gone", "REI"]]);
  });

  it("lists what friends still owe, and suggests recent fees and charges twice nobody asked back", () => {
    const dinner = { ...tx("2026-10-10", -9_000, "Olive Garden", "food"), owed: { who: "Sam", amount: 4_500, paid: null } };
    const paid = { ...tx("2026-10-11", -2_000, "Cinema", "fun"), owed: { who: "Ana", amount: 1_000, paid: "2026-10-12" } };
    const atm = tx("2026-10-15", -350, "ATM FEE", "other");
    const old = tx("2026-07-01", -350, "ATM FEE", "other");
    const one = tx("2026-10-18", -4_200, "SHELL OIL", "transport", "card");
    const two = tx("2026-10-18", -4_200, "SHELL OIL", "transport", "card");
    const r = refundsFor([dinner, paid, atm, old, one, two], {}, null, TODAY);
    expect(r.owed.map((o) => o.owed.who)).toEqual(["Sam"]);
    expect(r.owedTotal).toBe(4_500);
    expect(r.suggestions.map((s) => [s.kind, s.id, s.amount])).toEqual([
      ["double", two.id, 4_200],
      ["fee", atm.id, 350],
    ]);
    // Once asked for, it's waiting, not a suggestion.
    expect(refundsFor([atm], { [atm.id]: mark(atm, TODAY, { kind: "fee" }) }, null, TODAY).suggestions).toEqual([]);
  });

  it("guesses a fee's reversal for a fee, a return for anything else", () => {
    expect(refundKindOf(tx("2026-10-01", -350, "ATM FEE", "other"))).toBe("fee");
    expect(refundKindOf(tx("2026-10-01", -6_000, "Target", "shopping"))).toBe("return");
  });

  it("keeps marks sealed with the details, dropping any that don't read", () => {
    const kept = withRefundMark(NO_DETAILS, "t1", { name: "Target", date: "2026-10-12", amount: 6_499, kind: "return", asked: "2026-10-14" });
    expect(kept.refunds).toEqual({ t1: { name: "Target", date: "2026-10-12", amount: 6_499, kind: "return", asked: "2026-10-14" } });
    expect(withRefundMark(kept, "t1", null).refunds).toBeUndefined();
    const read = validDetails({
      v: 1,
      lines: {},
      refunds: {
        ok: { name: "REI", date: "2026-10-01", amount: 100, kind: "other", asked: "2026-10-02", got: "2026-10-05" },
        noKind: { name: "REI", date: "2026-10-01", amount: 100, kind: "gift", asked: "2026-10-02" },
        badDay: { name: "REI", date: "2026-02-30", amount: 100, kind: "return", asked: "2026-10-02" },
        free: { name: "REI", date: "2026-10-01", amount: 0, kind: "return", asked: "2026-10-02" },
        "t1~2": { name: "REI", date: "2026-10-01", amount: 100, kind: "return", asked: "2026-10-02" },
      },
    });
    expect(Object.keys(read.refunds ?? {})).toEqual(["ok"]);
  });
});
