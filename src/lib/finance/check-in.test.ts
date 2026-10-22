// The money check-in (check-in.ts): last month in numbers, what's worth a
// look from every part of Prism (most pressing first, each with the page that
// settles it), what changed, and the month ahead.

import { describe, expect, it } from "vitest";
import { checkIn } from "./check-in";
import { buildDemoData } from "./demo";
import { analyze } from "./model";

const TODAY = "2026-10-21";

describe("check-in", () => {
  const data = buildDemoData(TODAY);
  const c = checkIn(analyze(data));

  it("gives last month in numbers, the same the recap email sends", () => {
    expect(c.month?.month).toBe("2026-09");
    expect(c.month!.income).toBeGreaterThan(0);
    expect(c.month!.before).not.toBeNull();
  });

  it("gathers what's worth a look from every part of Prism, the most pressing first, each with its page", () => {
    const hrefs = c.items.map((i) => i.href);
    // A price rise, a late refund, a budget over, and a friend who still owes.
    expect(hrefs).toEqual(expect.arrayContaining(["/subscriptions", "/refunds", "/budgets"]));
    expect(c.items.find((i) => i.id.startsWith("refund:"))?.title).toBe("Your $3.50 refund from ATM FEE - NON-NETWORK is late");
    expect(c.items.find((i) => i.id.startsWith("owed:"))?.title).toBe("Sam still owes you $43.00");
    const tones = c.items.map((i) => ({ now: 0, soon: 1, idea: 2 })[i.tone]);
    expect(tones).toEqual([...tones].sort((x, y) => x - y));
    expect(new Set(c.items.map((i) => i.id)).size).toBe(c.items.length);
  });

  it("says what changed: the categories that moved most, and the prices that rose", () => {
    expect(c.moves.length).toBeGreaterThan(0);
    for (const m of c.moves) expect(Math.abs(m.change)).toBeGreaterThanOrEqual(5_000);
    expect(c.rises.map((r) => r.name)).toContain("Tunely Music");
  });

  it("looks ahead: the bills in the next 30 days and the next payday", () => {
    expect(c.ahead!.count).toBeGreaterThan(0);
    expect(c.nextPayday! > TODAY).toBe(true);
  });

  it("drops a refund once it's said to have come back", () => {
    const marks = Object.fromEntries(Object.entries(data.refundMarks!).map(([id, m]) => [id, { ...m, got: TODAY }]));
    expect(checkIn(analyze({ ...data, refundMarks: marks })).items.some((i) => i.id.startsWith("refund:"))).toBe(false);
  });

  it("mentions an estimated tax payment due within the month, with what the safe harbor asks for by then", () => {
    const soon = buildDemoData("2027-01-05");
    const last = soon.taxReturns![0]!;
    // In early January the payments being made are still for 2026, so it's the 2025 return that sets them.
    const withEstimates = { ...soon, taxReturns: [{ ...last, year: 2025, estimated: 200_000, withheld: 1_000_000, refund: null }] };
    const item = checkIn(analyze(withEstimates)).items.find((i) => i.id === "estimated-tax:2026:4");
    expect(item).toMatchObject({ tone: "soon", href: "/taxes", title: "Estimated tax payment due Jan 15" });
    expect(item?.detail).toMatch(/^Under the safe-harbor rule, about \$[\d,]+ more by then/);
    // And nothing for the example household as it is: no business, and its return had a refund.
    expect(c.items.some((i) => i.id.startsWith("estimated-tax:"))).toBe(false);
  });
});
