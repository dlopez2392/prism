// Buy now, pay later (paylater.ts): plans found from the payments to
// Affirm, Klarna, Afterpay, Sezzle and Zip.

import { describe, expect, it } from "vitest";
import { payLaterFor, payLaterOf } from "./paylater";
import { tx } from "./test-helpers";

const TODAY = "2026-10-21";

describe("pay later", () => {
  it("knows the providers by the names banks give them", () => {
    expect(payLaterOf("AFTERPAY US INC")).toBe("afterpay");
    expect(payLaterOf("Klarna* Target")).toBe("klarna");
    expect(payLaterOf("AFFIRM *PAYMENT")).toBe("affirm");
    expect(payLaterOf("SEZZLE")).toBe("sezzle");
    expect(payLaterOf("QUADPAY")).toBe("zip");
    expect(payLaterOf("Zippy's Car Wash")).toBeNull();
  });

  it("finds a pay-in-4 plan, what's left on it and when the next payment comes", () => {
    const lines = [tx("2026-09-30", -3_750, "Klarna* Target", "shopping"), tx("2026-10-14", -3_750, "KLARNA INC", "shopping")];
    const p = payLaterFor(lines, TODAY);
    expect(p.active).toHaveLength(1);
    expect(p.active[0]).toMatchObject({ provider: "klarna", installment: 3_750, cadence: "biweekly", left: 2, owed: 7_500, next: "2026-10-28" });
    expect(p).toMatchObject({ owed: 7_500, next30: 7_500 });
  });

  it("counts a plan paid off once four payments are in, and two plans for the same amount apart", () => {
    const four = ["2026-08-01", "2026-08-15", "2026-08-29", "2026-09-12"].map((d) => tx(d, -2_500, "AFTERPAY", "shopping"));
    const again = tx("2026-10-10", -2_500, "AFTERPAY", "shopping");
    const p = payLaterFor([...four, again], TODAY);
    expect(p.finished).toHaveLength(1);
    expect(p.active).toEqual([expect.objectContaining({ provider: "afterpay", left: 3, owed: 7_500, next: "2026-10-24" })]);
  });

  it("keeps a monthly plan as an ongoing payment, with no total it can't know", () => {
    const lines = ["2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"].map((d) => tx(d, -8_917, "AFFIRM *PAYMENT", "shopping"));
    const p = payLaterFor(lines, TODAY);
    expect(p.active[0]).toMatchObject({ provider: "affirm", cadence: "monthly", left: null, owed: null, next: "2026-11-05" });
    expect(p).toMatchObject({ owed: 0, monthly: 8_917, next30: 8_917 });
  });

  it("drops a plan whose next payment never came", () => {
    const lines = [tx("2026-08-01", -3_000, "SEZZLE", "shopping"), tx("2026-08-15", -3_000, "SEZZLE", "shopping")];
    expect(payLaterFor(lines, TODAY).active).toEqual([]);
  });
});
