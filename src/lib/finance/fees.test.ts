// Money lost without noticing (fees.ts): every fee, what came back, and
// what may have been charged twice.

import { describe, expect, it } from "vitest";
import { feeKind, feesFor, refundRequest } from "./fees";
import { generateInsights } from "./insights";
import { tx } from "./test-helpers";

const TODAY = "2026-10-21";

describe("fees", () => {
  it("finds a fee from the bank's own category, or from its words on a line that reads as a bill", () => {
    expect(feeKind({ ...tx("2026-10-01", -3_500, "Everyday Checking", "other"), bankFee: "overdraft" })).toBe("overdraft");
    expect(feeKind(tx("2026-10-01", -350, "NON-NETWORK ATM FEE", "other"))).toBe("atm");
    expect(feeKind(tx("2026-10-01", -1_200, "MONTHLY MAINTENANCE FEE", "bills"))).toBe("maintenance");
    expect(feeKind(tx("2026-10-01", -237, "Foreign Transaction Fee", "other"))).toBe("foreign");
    expect(feeKind(tx("2026-10-01", -3_400, "Returned Item Fee", "other"))).toBe("nsf");
    // Not the bank's: a ticket's service fee, interest, money coming in, or something too big to be a fee by its words alone.
    expect(feeKind(tx("2026-10-01", -899, "Ticketmaster service fee", "fun"))).toBeNull();
    expect(feeKind({ ...tx("2026-10-01", -3_412, "INTEREST CHARGE", "bills"), interestCharge: true })).toBeNull();
    expect(feeKind(tx("2026-10-01", 3_500, "Overdraft fee refund", "other"))).toBeNull();
    expect(feeKind(tx("2026-10-01", -25_000, "Account service charge", "bills"))).toBeNull();
  });

  it("adds them up, and counts one given back as refunded", () => {
    const lines = [
      { ...tx("2026-09-10", -3_500, "Overdraft Item Fee", "other"), bankFee: "overdraft" as const },
      tx("2026-09-14", 3_500, "OVERDRAFT FEE REFUND", "other"),
      { ...tx("2026-10-02", -3_500, "Overdraft Item Fee", "other"), bankFee: "overdraft" as const },
      tx("2026-02-03", -350, "ATM FEE", "other"),
      tx("2025-09-01", -1_200, "MONTHLY SERVICE FEE", "bills"),
    ];
    const f = feesFor(lines, TODAY);
    expect(f.fees.map((x) => [x.date, x.kind, x.refund?.date ?? null])).toEqual([
      ["2026-10-02", "overdraft", null],
      ["2026-09-10", "overdraft", "2026-09-14"],
      ["2026-02-03", "atm", null],
    ]);
    expect(f).toMatchObject({ paid12: 7_350, refunded12: 3_500, paidThisYear: 7_350 });
    expect(f.byKind).toEqual([
      { kind: "overdraft", count: 2, lost: 3_500 },
      { kind: "atm", count: 1, lost: 350 },
    ]);
  });

  it("asks whether two same charges on the same day were meant, never small ones or a fee", () => {
    const f = feesFor(
      [
        tx("2026-10-05", -4_999, "Best Buy #123", "shopping"),
        tx("2026-10-05", -4_999, "BEST BUY #456", "shopping"),
        tx("2026-10-05", -550, "Starbucks", "food"),
        tx("2026-10-05", -550, "Starbucks", "food"),
        tx("2026-10-06", -4_999, "Best Buy", "shopping"),
      ],
      TODAY,
    );
    expect(f.doubles).toEqual([{ accountId: "chk", date: "2026-10-05", merchant: "Best Buy #123", amount: 4_999, ids: expect.any(Array) }]);
    expect(f.doubles[0]!.ids).toHaveLength(2);
  });

  it("words a refund request the person can send themselves", () => {
    expect(refundRequest({ kind: "overdraft", amount: 3_500, date: "2026-10-02" }, "Everyday Checking ••4821")).toBe(
      "Hello, I see an overdraft fee of $35.00 on Oct 2 on my account Everyday Checking ••4821. I've been a loyal customer, and I'd be grateful if you could refund it as a courtesy. Thank you.",
    );
  });

  it("is a heads-up on Overview while a fee from the last 30 days hasn't come back", () => {
    const insight = (lines: ReturnType<typeof tx>[]) => generateInsights({ txns: lines, today: TODAY, budgets: [], streams: [], flows: [] }).find((i) => i.id === "fees");
    const fee = { ...tx("2026-10-10", -3_500, "Overdraft Item Fee", "other"), bankFee: "overdraft" as const };
    expect(insight([fee])).toMatchObject({ tone: "heads_up", title: "Your bank charged you a $35.00 fee", evidence: [fee.id] });
    expect(insight([fee, tx("2026-10-12", 3_500, "Overdraft fee refund", "other")])).toBeUndefined();
    expect(insight([{ ...fee, date: "2026-08-01" }])).toBeUndefined();
  });
});
