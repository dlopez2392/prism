// What a person adds to their own transactions (details.ts): a split that
// becomes its parts everywhere money is counted and stays one bill where
// things repeat; tags they can total; and who owes them, counted once.

import { describe, expect, it } from "vitest";
import { categoryTotals } from "./cashflow";
import { applyDetails, checkDetail, cleanTag, DETAIL_LIMITS, NO_DETAILS, partsByShare, reminderText, ruleKey, sharesOf, stillOwed, tagTotals, validDetails, validRule, wholeLines, withDetail, withRule, type SplitRule, type TxnDetails } from "./details";
import { dailyDriftStats } from "./forecast";
import { generateInsights } from "./insights";
import { detectRecurring } from "./recurring";
import { taxSummary } from "./taxes";
import { monthly, tx } from "./test-helpers";
import type { Transaction } from "./types";

const costco = (): Transaction => ({ ...tx("2026-09-20", -15_000, "Costco", "food"), id: "c1" });
const details = (lines: TxnDetails["lines"]): TxnDetails => ({ v: 1, lines });

describe("a split", () => {
  it("becomes its parts, each in its own category, and the totals follow", () => {
    const [food, home] = applyDetails([costco()], details({ c1: { split: [{ category: "food", amount: 9_000 }, { category: "shopping", amount: 6_000 }] } }));
    expect(food).toMatchObject({ id: "c1~1", amount: -9_000, category: "food", split: { of: "c1", part: 1, parts: 2, total: -15_000 } });
    expect(food!.bankCategory).toBeUndefined();
    // The part the person moved says what the bank had said.
    expect(home).toMatchObject({ id: "c1~2", amount: -6_000, category: "shopping", bankCategory: "food" });
    const totals = categoryTotals([food!, home!], "2026-09-01", "2026-09-30");
    expect([totals.food, totals.shopping]).toEqual([9_000, 6_000]);
  });

  it("is set aside, never stretched, when the bank's amount has changed since", () => {
    const tipped = { ...costco(), amount: -16_500 };
    const [t] = applyDetails([tipped], details({ c1: { split: [{ category: "food", amount: 9_000 }, { category: "shopping", amount: 6_000 }], tags: ["Party"] } }));
    expect(t).toMatchObject({ id: "c1", amount: -16_500, category: "food", tags: ["Party"] });
    expect(t!.split).toBeUndefined();
  });

  it("is still one bill to what looks for things that repeat", () => {
    const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
    const phone = monthly(months, 12, -12_000, "Pulse Mobile", "bills").map((t, i) => ({ ...t, id: `ph${i}` }));
    const split = applyDetails(phone, details(Object.fromEntries(phone.map((t) => [t.id, { split: [{ category: "bills" as const, amount: 8_000 }, { category: "fun" as const, amount: 4_000 }] }]))));
    expect(split).toHaveLength(10);
    const [stream] = detectRecurring(split, "2026-09-20").filter((s) => s.merchant === "Pulse Mobile");
    expect(stream).toMatchObject({ amount: -12_000, cadence: "monthly", category: "bills", transactionIds: phone.map((t) => t.id) });
  });

  it("joins back whole: the bank's amount, the largest part's category, the bank's category kept", () => {
    const parts = applyDetails([costco()], details({ c1: { split: [{ category: "food", amount: 5_000 }, { category: "shopping", amount: 10_000 }], owed: { who: "Sam", amount: 5_000, paid: null } } }));
    const [whole] = wholeLines(parts);
    expect(whole).toMatchObject({ id: "c1", amount: -15_000, category: "shopping", bankCategory: "food", owed: { who: "Sam" } });
    expect(whole!.split).toBeUndefined();
    const plain = [tx("2026-09-01", -100, "A", "food")];
    expect(wholeLines(plain)).toBe(plain);
  });

  it("stays out of the day-to-day drift, and out of the one-off purchases, when it's a bill that repeats", () => {
    const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
    const rent = monthly(months, 15, -150_000, "Oak Street Rent", "housing").map((t, i) => ({ ...t, id: `r${i}` }));
    const supplies = months.flatMap((m, i) => [tx(`${m}-03`, -2_000, "Home Depot", "housing"), tx(`${m}-20`, -1_500, "Home Depot", "housing")].map((t, j) => ({ ...t, id: `hd${i}${j}` })));
    const split = applyDetails([...rent, ...supplies], details(Object.fromEntries(rent.map((t) => [t.id, { split: [{ category: "housing" as const, amount: 120_000 }, { category: "bills" as const, amount: 30_000 }] }]))));
    const today = "2026-09-20";
    const streams = detectRecurring(split, today);
    const ids = new Set(streams.flatMap((s) => s.transactionIds));
    expect(ids.has("r4")).toBe(true);
    // Rent alone: every part belongs to the rent's stream, so nothing is left as day-to-day.
    const drift = dailyDriftStats(split.filter((t) => !t.merchant.startsWith("Home")), "chk", ids, today);
    expect(drift.mean).toBe(0);
    const insights = generateInsights({ txns: split, today, budgets: [], streams, flows: [] });
    expect(insights.some((i) => i.id.startsWith("oneoff-"))).toBe(false);
  });

  it("lets a pharmacy run count only its medicine for taxes", () => {
    const cvs: Transaction = { ...tx("2026-03-02", -8_000, "CVS Pharmacy", "health"), id: "rx", taxHint: "medical" };
    const parts = applyDetails([cvs], details({ rx: { split: [{ category: "health", amount: 3_000 }, { category: "shopping", amount: 5_000 }] } }));
    const medical = taxSummary({ today: "2026-12-31", transactions: parts }, 2026).sections.find((s) => s.id === "medical");
    expect(medical).toMatchObject({ total: 3_000 });
  });
});

describe("what someone owes", () => {
  it("is counted once on a split line, and listed while it's open, oldest first", () => {
    const later = { ...tx("2026-09-25", -4_000, "Pizza Place", "food"), id: "p1" };
    const lines = applyDetails([later, costco()], details({ c1: { split: [{ category: "food", amount: 9_000 }, { category: "shopping", amount: 6_000 }], owed: { who: "Sam", amount: 7_500, paid: null } }, p1: { owed: { who: "Alex", amount: 2_000, paid: null } } }));
    expect(lines.filter((t) => t.owed)).toHaveLength(2);
    expect(stillOwed(lines).map((x) => [x.owed.who, x.owed.amount, x.t.id])).toEqual([
      ["Sam", 7_500, "c1~1"],
      ["Alex", 2_000, "p1"],
    ]);
  });

  it("can be asked for with a friendly reminder the person sends themselves", () => {
    expect(reminderText({ who: "Sam", amount: 2_550, merchant: "Pizza Place", date: "2026-09-05" })).toBe("Hi Sam, a quick reminder about the $25.50 for Pizza Place on Sep 5. Thanks!");
  });

  it("drops off the list once it's paid back", () => {
    const lines = applyDetails([costco()], details({ c1: { owed: { who: "Sam", amount: 7_500, paid: "2026-09-30" } } }));
    expect(stillOwed(lines)).toEqual([]);
  });
});

describe("tags", () => {
  it("total what was spent under each, counting a split line once", () => {
    const hotel = { ...tx("2026-07-02", -60_000, "Seaside Inn", "travel"), id: "h1" };
    const lines = applyDetails([hotel, costco()], details({ h1: { tags: ["Vacation 2026"] }, c1: { tags: ["vacation 2026", "Party"], split: [{ category: "food", amount: 9_000 }, { category: "shopping", amount: 6_000 }] } }));
    expect(tagTotals(lines)).toEqual([
      { tag: "Vacation 2026", spent: 75_000, count: 2 },
      { tag: "Party", spent: 15_000, count: 1 },
    ]);
  });

  it("are cleaned: words only, no control or direction characters, one space between, kept short", () => {
    expect(cleanTag("  Vacation\u202e  2026\n")).toBe("Vacation 2026");
    expect(cleanTag("x".repeat(50))).toHaveLength(DETAIL_LIMITS.tagLength);
    expect(cleanTag("   ")).toBeNull();
    expect(cleanTag(7)).toBeNull();
  });
});

describe("a change the person asks for", () => {
  const t = { amount: -15_000, category: "food" as const };

  it("keeps a split whose parts add up exactly, with tags and what's owed", () => {
    expect(checkDetail(t, { split: [{ category: "food", amount: 9_000 }, { category: "shopping", amount: 6_000 }], tags: ["Party", "party", ""], owed: { who: " Sam ", amount: 5_000, paid: null } })).toEqual({
      detail: { split: [{ category: "food", amount: 9_000 }, { category: "shopping", amount: 6_000 }], tags: ["Party"], owed: { who: "Sam", amount: 5_000, paid: null } },
    });
  });

  it("refuses parts that don't add up, a split of money coming in, and a category that isn't spending", () => {
    expect(checkDetail(t, { split: [{ category: "food", amount: 9_000 }, { category: "shopping", amount: 5_000 }] })).toEqual({ error: "The parts add up to $140.00; they need to add up to $150.00." });
    expect(checkDetail({ amount: 15_000, category: "income" }, { split: [{ category: "food", amount: 9_000 }, { category: "shopping", amount: 6_000 }] })).toMatchObject({ error: expect.stringMatching(/money going out/) });
    expect(checkDetail(t, { split: [{ category: "income", amount: 9_000 }, { category: "food", amount: 6_000 }] })).toMatchObject({ error: expect.stringMatching(/2 to 8 parts/) });
    expect(checkDetail(t, { split: [{ category: "food", amount: 15_000 }] })).toMatchObject({ error: expect.stringMatching(/2 to 8 parts/) });
    expect(checkDetail(t, { split: Array.from({ length: 9 }, () => ({ category: "food", amount: 1 })) })).toMatchObject({ error: expect.stringMatching(/2 to 8 parts/) });
  });

  it("refuses an amount owed above what it cost, a nameless one, and owed on money coming in", () => {
    expect(checkDetail(t, { owed: { who: "Sam", amount: 15_001, paid: null } })).toEqual({ error: "They can owe you at most $150.00, what this cost." });
    expect(checkDetail(t, { owed: { who: "  ", amount: 100, paid: null } })).toMatchObject({ error: expect.stringMatching(/who owes you/) });
    expect(checkDetail({ amount: 500, category: "other" }, { owed: { who: "Sam", amount: 100, paid: null } })).toMatchObject({ error: expect.stringMatching(/money you paid out/) });
  });

  it("clears the line when nothing is left", () => {
    expect(checkDetail(t, { tags: [] })).toEqual({ detail: null });
    const kept = withDetail(details({ c1: { tags: ["Party"] } }), "c1", null);
    expect(kept).toEqual(NO_DETAILS);
  });
});

describe("what's stored", () => {
  it("is read back only as far as it's valid, never guessed at", () => {
    expect(validDetails(null)).toEqual(NO_DETAILS);
    expect(validDetails({ v: 2, lines: {} })).toEqual(NO_DETAILS);
    const read = validDetails({
      v: 1,
      lines: {
        good: { tags: ["Trip"] },
        "bad~1": { tags: ["Part ids are never keys"] },
        empty: {},
        junk: { split: "lots", owed: { who: "", amount: 1, paid: null } },
        half: { tags: ["Kept"], split: [{ category: "food", amount: -5 }, { category: "fun", amount: 5 }] },
      },
    });
    expect(read).toEqual({ v: 1, lines: { good: { tags: ["Trip"] }, half: { tags: ["Kept"] } } });
  });

  it("keeps at most so many lines", () => {
    const many = Object.fromEntries(Array.from({ length: DETAIL_LIMITS.lines + 10 }, (_, i) => [`t${i}`, { tags: ["x"] }]));
    expect(Object.keys(validDetails({ v: 1, lines: many }).lines)).toHaveLength(DETAIL_LIMITS.lines);
  });

  it("changes nothing when there's nothing to apply", () => {
    const list = [costco()];
    expect(applyDetails(list, NO_DETAILS)).toBe(list);
  });
});

describe("a split that follows a shop", () => {
  const costco: SplitRule = { name: "Costco", split: [{ category: "food", share: 7_000 }, { category: "shopping", share: 3_000 }] };
  const withCostco = (lines: TxnDetails["lines"] = {}): TxnDetails => ({ v: 1, lines, rules: { costco } });
  const at = (id: string, amount: number, merchant = "COSTCO #482", category: Transaction["category"] = "food") => ({ ...tx("2026-09-20", amount, merchant, category), id });

  it("splits every purchase there by its shares, to the cent, under any of the shop's spellings", () => {
    const [food, home] = applyDetails([at("c9", -10_001)], withCostco());
    // 70% of $100.01 is 7000.7 cents and 30% is 3000.3: the extra cent goes to the bigger remainder.
    expect(food).toMatchObject({ id: "c9~1", amount: -7_001, category: "food", split: { of: "c9", part: 1, parts: 2, total: -10_001, rule: true } });
    expect(home).toMatchObject({ id: "c9~2", amount: -3_000, category: "shopping", bankCategory: "food" });
    expect(applyDetails([at("c8", -5_000, "Costco")], withCostco())).toHaveLength(2);
    expect(ruleKey("  COSTCO   #482 ")).toBe("costco");
    expect(ruleKey("#123")).toBeNull();
  });

  it("leaves alone what isn't a purchase there, one split by hand, one kept whole, and one too small to split", () => {
    const refund = at("r1", 2_000);
    const pay = at("i1", -1_000, "Costco", "income");
    const other = at("t1", -5_000, "Target");
    expect(applyDetails([refund, pay, other], withCostco())).toEqual([refund, pay, other]);
    const own = applyDetails([at("c1", -15_000)], withCostco({ c1: { split: [{ category: "fun", amount: 5_000 }, { category: "food", amount: 10_000 }] } }));
    expect(own.map((t) => [t.category, t.amount, t.split?.rule])).toEqual([
      ["fun", -5_000, undefined],
      ["food", -10_000, undefined],
    ]);
    expect(applyDetails([at("c2", -15_000)], withCostco({ c2: { whole: true, tags: ["Party"] } }))).toEqual([{ ...at("c2", -15_000), tags: ["Party"] }]);
    // One cent can't be split in two.
    expect(applyDetails([at("c3", -1)], withCostco())).toEqual([at("c3", -1)]);
    // A split of its own that no longer adds up is set aside, and the shop's doesn't step in.
    expect(applyDetails([at("c4", -16_500)], withCostco({ c4: { split: [{ category: "fun", amount: 5_000 }, { category: "food", amount: 10_000 }] } }))).toEqual([at("c4", -16_500)]);
  });

  it("is still one purchase to what looks for things that repeat", () => {
    const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
    const runs = monthly(months, 6, -12_000, "COSTCO #482", "food").map((t, i) => ({ ...t, id: `k${i}` }));
    const split = applyDetails(runs, withCostco());
    expect(split).toHaveLength(10);
    expect(wholeLines(split).map((t) => [t.id, t.amount, t.split])).toEqual(runs.map((t) => [t.id, -12_000, undefined]));
    expect(detectRecurring(split, "2026-09-20")[0]).toMatchObject({ amount: -12_000, cadence: "monthly", transactionIds: runs.map((t) => t.id) });
  });

  it("keeps shares that add up to the whole, from parts by largest remainder", () => {
    expect(sharesOf([{ category: "food", amount: 9_000 }, { category: "shopping", amount: 6_000 }])).toEqual([{ category: "food", share: 6_000 }, { category: "shopping", share: 4_000 }]);
    // Thirds: 3333.33 each, and the leftover hundredth goes to the first.
    expect(sharesOf([{ category: "food", amount: 100 }, { category: "fun", amount: 100 }, { category: "health", amount: 100 }])!.map((p) => p.share)).toEqual([3_334, 3_333, 3_333]);
    expect(partsByShare(100, [{ category: "food", share: 3_334 }, { category: "fun", share: 3_333 }, { category: "health", share: 3_333 }]).map((p) => p.amount)).toEqual([34, 33, 33]);
    // The spare cent goes where the most was rounded away, wherever that part sits.
    expect(partsByShare(10_001, [{ category: "food", share: 3_000 }, { category: "fun", share: 7_000 }]).map((p) => p.amount)).toEqual([3_000, 7_001]);
    expect(partsByShare(2, [{ category: "food", share: 3_334 }, { category: "fun", share: 3_333 }, { category: "health", share: 3_333 }]).map((p) => p.amount)).toEqual([1, 1]);
  });

  it("is stored only as a whole, valid split under a key a shop's name could make", () => {
    expect(validRule(costco)).toEqual(costco);
    expect(validRule({ ...costco, name: "  Costco\u202e " })).toEqual(costco);
    for (const bad of [
      { ...costco, name: "" },
      { ...costco, split: [{ category: "food", share: 10_000 }] },
      { ...costco, split: [{ category: "food", share: 7_000 }, { category: "shopping", share: 2_999 }] },
      { ...costco, split: [{ category: "income", share: 7_000 }, { category: "shopping", share: 3_000 }] },
      { ...costco, split: [{ category: "food", share: 10_001 }, { category: "shopping", share: -1 }] },
      { ...costco, split: [{ category: "food", share: 6_999.5 }, { category: "shopping", share: 3_000.5 }] },
    ]) {
      expect(validRule(bad)).toBeNull();
    }
    const read = validDetails({ v: 1, lines: {}, rules: { costco, "COSTCO #482": costco, target: { name: "Target" }, ["x".repeat(121)]: costco, ["y".repeat(120)]: costco } });
    expect(read).toEqual({ v: 1, lines: {}, rules: { costco, ["y".repeat(120)]: costco } });
    expect(validDetails({ v: 1, lines: {}, rules: { costco: { ...costco, split: [] } } })).toEqual(NO_DETAILS);
    const many = Object.fromEntries(Array.from({ length: DETAIL_LIMITS.rules + 5 }, (_, i) => [`shop-${i}`, costco]));
    expect(Object.keys(validDetails({ v: 1, lines: {}, rules: many }).rules!)).toHaveLength(DETAIL_LIMITS.rules);
  });

  it("is kept beside every line's details, and taken away on its own", () => {
    const both = withDetail(withCostco(), "c1", { tags: ["Party"] });
    expect(both).toEqual({ v: 1, lines: { c1: { tags: ["Party"] } }, rules: { costco } });
    expect(withRule(both, "costco", null)).toEqual({ v: 1, lines: { c1: { tags: ["Party"] } } });
    expect(withRule(NO_DETAILS, "target", { ...costco, name: "Target" })).toEqual({ v: 1, lines: {}, rules: { target: { ...costco, name: "Target" } } });
    // Kept whole means nothing next to a split of its own.
    expect(validDetails({ v: 1, lines: { c1: { whole: true, split: [{ category: "food", amount: 1 }, { category: "fun", amount: 1 }] }, c2: { whole: "yes" } } })).toEqual({
      v: 1,
      lines: { c1: { split: [{ category: "food", amount: 1 }, { category: "fun", amount: 1 }] } },
    });
  });
});
