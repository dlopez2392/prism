import { describe, expect, it } from "vitest";
import { buildDemoData } from "./demo";
import { analyze } from "./model";

const TODAY = "2026-09-27";

describe("the demo household", () => {
  const data = buildDemoData(TODAY);

  it("is deterministic for a given day", () => {
    expect(buildDemoData(TODAY)).toEqual(data);
  });

  it("never invents the future", () => {
    expect(data.transactions.every((t) => t.date <= TODAY)).toBe(true);
    expect(new Set(data.transactions.map((t) => t.id)).size).toBe(data.transactions.length);
  });

  it("derives cash balances from the transactions, to the cent", () => {
    const months = analyze(data).months;
    for (const id of ["demo-chk", "demo-sav", "demo-card"]) {
      const account = data.accounts.find((a) => a.id === id)!;
      expect(account.balance).toBe(account.history.at(-1));
      for (let i = 1; i < months.length; i++) {
        const moved = data.transactions
          .filter((t) => t.accountId === id && t.date.startsWith(months[i]!))
          .reduce((s, t) => s + t.amount, 0);
        expect(account.history[i]! - account.history[i - 1]!).toBe(moved);
      }
    }
  });

  it("holds investments that add up to their accounts", () => {
    for (const a of data.accounts.filter((x) => ["investment", "retirement", "crypto"].includes(x.kind))) {
      const held = data.holdings.filter((h) => h.accountId === a.id).reduce((s, h) => s + h.value, 0);
      expect(held).toBe(a.balance);
    }
  });

  it("tells the story the insights are meant to find", () => {
    const model = analyze(data);
    const ids = model.insights.map((i) => i.id);
    expect(ids.some((id) => id.startsWith("price-"))).toBe(true);
    expect(model.streams.some((s) => s.kind === "income" && s.cadence === "biweekly")).toBe(true);
    expect(model.insights.every((i) => i.evidence.length > 0)).toBe(true);
    expect(model.safe).not.toBeNull();
  });
});
