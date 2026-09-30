import { describe, expect, it } from "vitest";
import { budgetStatuses } from "./budgets";
import { monthlyCashFlow } from "./cashflow";
import { lastMonths } from "./dates";
import { generateInsights } from "./insights";
import { detectRecurring } from "./recurring";
import { monthly, tx } from "./test-helpers";
import type { Budget, Transaction } from "./types";

const TODAY = "2026-09-25";

function run(txns: Transaction[], budgets: Budget[] = []) {
  return generateInsights({
    txns,
    today: TODAY,
    budgets: budgetStatuses(budgets, txns, TODAY),
    streams: detectRecurring(txns, TODAY),
    flows: monthlyCashFlow(txns, lastMonths(TODAY, 13)),
  });
}

describe("generateInsights", () => {
  it("says nothing when there is nothing to say", () => {
    expect(run([])).toEqual([]);
  });

  it("flags a price rise and cites the charges it came from", () => {
    const charges = monthly(
      ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
      22,
      [-1_549, -1_549, -1_549, -1_549, -1_799, -1_799],
      "Streamflix",
      "fun",
      "card",
    );
    const [price] = run(charges).filter((i) => i.id.startsWith("price-"));
    expect(price!.title).toBe("Streamflix raised its price to $17.99");
    expect(price!.tone).toBe("heads_up");
    expect(price!.evidence).toEqual(charges.slice(-4).map((t) => t.id));
    expect(price!.detail).toContain("$30 more a year");
  });

  it("counts a raise by how often pay actually comes: twice a month is 24 paydays, not 26", () => {
    const dates = ["2026-05-15", "2026-05-29", "2026-06-15", "2026-06-30", "2026-07-15", "2026-07-31", "2026-08-14", "2026-08-31", "2026-09-15"];
    const pays = dates.map((d, i) => ({ ...tx(d, i < 6 ? 250_000 : 260_000, "ACME CORP PAYROLL", "income"), id: `p${i}` }));
    const [raise] = run(pays).filter((i) => i.id.startsWith("raise-"));
    expect(raise!.title).toBe("Your paycheck went up 4.0%");
    // $100 a payday × 24 paydays.
    expect(raise!.detail).toBe("$100.00 more every payday — about $2,400 a year. Nice.");
  });

  it("leads with an over-budget category and shows its transactions", () => {
    const shoes = tx("2026-09-10", -30_000, "Shoe shop", "shopping");
    const [first] = run([shoes], [{ category: "shopping", limit: 20_000 }]);
    expect(first).toMatchObject({
      tone: "heads_up",
      title: "Shopping is $100 over budget",
      evidence: [shoes.id],
    });
  });
});
