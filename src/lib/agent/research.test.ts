// Prism's money as documents for ChatGPT's deep research: what a question
// finds, that every document it finds can be read, and that each one says the
// same as the screen its link opens.

import { describe, expect, it } from "vitest";
import { monthlyCashFlow } from "@/lib/finance/cashflow";
import { buildDemoData } from "@/lib/finance/demo";
import { money } from "@/lib/finance/format";
import { monthWindow, readLedgerHash } from "@/lib/finance/view";
import { yearReview } from "@/lib/finance/year";
import { DOC_TRANSACTIONS_MAX, RESEARCH_RESULTS_MAX, researchFetch, researchSearch } from "./research";
import { overview, upcomingBills, type AgentData } from "./tools";

const TODAY = "2026-09-18";
const SITE = "https://prism.example";
const demo = (): AgentData => ({ ...buildDemoData(TODAY), demo: true, notice: null, timeZone: "America/Chicago", budgetsSetByPerson: false });
const live = (): AgentData => ({ ...demo(), demo: false, notice: "Chase needs you to sign in again." });

const ids = (query: string, data = demo()) => researchSearch(data, SITE, query).results.map((r) => r.id);
const read = (id: string, data = demo()) => researchFetch(data, SITE, id);
const SUMMARY_IDS = ["overview", "spending", "cash-flow", "budgets", "bills", "accounts", "net-worth", "goals", "income"];

describe("search", () => {
  it("finds the month or the year a question names", () => {
    expect(ids("March 2026")[0]).toBe("month:2026-03");
    expect(ids("spending in 2026-03")[0]).toBe("month:2026-03");
    // No year: the latest March Prism holds.
    expect(ids("what happened in march")[0]).toBe("month:2026-03");
    expect(ids("september")).toContain("month:2026-09");
    expect(ids("september")).not.toContain("month:2025-09");
    expect(ids("last month")[0]).toBe("month:2026-08");
    expect(ids("this month")[0]).toBe("month:2026-09");
    expect(ids("2025")[0]).toBe("year:2025");
    expect(ids("this year")[0]).toBe("year:2026");
    expect(ids("2025 against 2026").slice(0, 2).sort()).toEqual(["year:2025", "year:2026"]);
  });

  it("never offers a month or a year Prism has no record of", () => {
    expect(ids("March 2019").filter((id) => id.includes("2019"))).toEqual([]);
    expect(ids("2019")).not.toContain("year:2019");
  });

  it("finds a merchant by its name, or the start of it, and a category by the words people use", () => {
    expect(ids("green basket")[0]).toBe("merchant:green basket market");
    expect(ids("how much at sakura")[0]).toBe("merchant:sakura sushi bar");
    expect(ids("sush")[0]).toBe("merchant:sakura sushi bar");
    expect(ids("groceries")[0]).toBe("category:food");
    expect(ids("rent")[0]).toBe("category:housing");
    expect(ids("utilities")[0]).toBe("category:bills");
    // A category is more particular than the summary a word also names.
    expect(ids("spending on food")[0]).toBe("category:food");
    // A topic's word means the topic, before a merchant that happens to use it; the merchant's own name still finds it.
    expect(ids("food")[0]).toBe("category:food");
    expect(ids("riverside food bank")[0]).toBe("merchant:riverside food bank");
  });

  it("doesn't stretch a merchant's name to fit: 'whole foods' isn't a food bank, 'green' isn't Evergreen", () => {
    expect(ids("whole foods").some((id) => id.startsWith("merchant:"))).toBe(false);
    expect(ids("green")).not.toContain("merchant:transfer to evergreen brokerage");
  });

  it("finds the summary a topic belongs to", () => {
    expect(ids("subscriptions")[0]).toBe("bills");
    expect(ids("how am I doing")[0]).toBe("overview");
    expect(ids("net worth")[0]).toBe("net-worth");
    expect(ids("my paychecks")[0]).toBe("income");
    expect(ids("savings goals")[0]).toBe("goals");
  });

  it("answers a question that names nothing with the summaries and this month", () => {
    const fallback = [...SUMMARY_IDS, "month:2026-09"];
    expect(ids("")).toEqual(fallback);
    expect(ids("zzzz qqqq")).toEqual(fallback);
  });

  it("returns at most ten, each once, each with an absolute link into Prism", () => {
    const many = "food fun travel bills housing health shopping transport other budgets goals income";
    expect(researchSearch(demo(), SITE, many).results).toHaveLength(RESEARCH_RESULTS_MAX);
    for (const q of ["", "food", "2025 2026", "a b c d e f g h", "market", many]) {
      const { results } = researchSearch(demo(), SITE, q);
      expect(results.length).toBeLessThanOrEqual(RESEARCH_RESULTS_MAX);
      expect(new Set(results.map((r) => r.id)).size).toBe(results.length);
      for (const r of results) {
        expect(r.url.startsWith(`${SITE}/`)).toBe(true);
        expect(r.title).not.toBe("");
      }
    }
  });

  it("links a merchant and a category to the ledger, narrowed in a fragment the server never sees", () => {
    const [merchant] = researchSearch(demo(), SITE, "green basket").results;
    const url = new URL(merchant!.url);
    expect(url.pathname + url.search).toBe("/spending?range=12");
    expect(readLedgerHash(url.hash)).toEqual({ find: "green basket market" });
    const [food] = researchSearch(demo(), SITE, "groceries").results;
    expect(readLedgerHash(new URL(food!.url).hash)).toEqual({ category: "food" });
  });
});

describe("fetch", () => {
  it("reads every document a search can return, with the same title and link", () => {
    const data = demo();
    const all = new Set<string>();
    for (const q of ["", "2025", "2026", "march", "last month", "food", "rent", "bills", "travel", "fun", "other", "green basket", "sushi", "market", "fuel"]) {
      for (const hit of researchSearch(data, SITE, q).results) {
        all.add(hit.id);
        const doc = researchFetch(data, SITE, hit.id)!;
        expect(doc).toMatchObject(hit);
        expect(doc.text).toContain(`Open in Prism: ${hit.url}`);
        expect(doc.text.length).toBeLessThan(60_000);
        for (const v of Object.values(doc.metadata)) expect(["string", "number", "boolean"]).toContain(typeof v);
      }
    }
    expect([...all].some((id) => id.startsWith("merchant:"))).toBe(true);
  });

  it("says, at the top, whose money it is and anything that may leave it incomplete", () => {
    const d = read("overview")!;
    expect(d.text).toMatch(/As of 2026-09-18 \(America\/Chicago\)/);
    expect(d.text).toMatch(/example household .* NOT the user's money/);
    expect(d.metadata).toMatchObject({ kind: "summary", as_of: TODAY, demo: true });
    const l = read("overview", live())!;
    expect(l.text).not.toMatch(/example household/);
    expect(l.text).toContain("Notice: Chase needs you to sign in again.");
    expect(l.metadata.demo).toBe(false);
  });

  it("gives a summary exactly as its tool does", () => {
    const data = demo();
    const body = (id: string) => JSON.parse(read(id, data)!.text.slice(read(id, data)!.text.indexOf("\n{")));
    // The header says when, where and whose; the body is the rest of the tool's answer, as it is.
    const framed = new Set(["as_of", "time_zone", "currency", "demo", "demo_note", "notice"]);
    const rest = Object.fromEntries(Object.entries(overview(data)).filter(([k]) => !framed.has(k)));
    expect(body("overview")).toEqual(JSON.parse(JSON.stringify(rest)));
    expect(body("bills").items).toEqual(JSON.parse(JSON.stringify(upcomingBills(data, { days: 90 }).items)));
  });

  it("counts a month as every screen does, and cites every transaction in it", () => {
    const data = demo();
    const doc = read("month:2026-08", data)!;
    const flow = monthlyCashFlow(data.transactions, ["2026-08"])[0]!;
    expect(doc.text).toContain(`Income: ${money(flow.income)}. Spending: ${money(flow.spending)}. Kept: ${money(flow.net)}.`);
    expect(doc.metadata).toMatchObject({ kind: "month", from: "2026-08-01", to: "2026-08-31" });
    const august = data.transactions.filter((t) => t.date.startsWith("2026-08"));
    expect(august.length).toBeLessThanOrEqual(DOC_TRANSACTIONS_MAX);
    for (const t of august) expect(doc.text).toContain(`| id ${t.id}`);
    // This month stops at today.
    expect(read("month:2026-09", data)!.metadata).toMatchObject({ from: "2026-09-01", to: TODAY });
  });

  it("counts a year as the year page does", () => {
    const data = demo();
    const r = yearReview(data, 2025);
    const doc = read("year:2025", data)!;
    expect(doc.text).toContain(`Totals: income ${money(r.totals.income)}, spending ${money(r.totals.spending)}, kept ${money(r.totals.kept)}`);
    expect(doc.text).toContain("Prism's records start on 2025-09-01");
    expect(doc.url).toBe(`${SITE}/year?y=2025`);
  });

  it("covers a category over the twelve months its link shows, and lists the newest when there are too many to list", () => {
    const data = demo();
    const w = monthWindow(TODAY, 12);
    const doc = read("category:food", data)!;
    expect(doc.metadata).toMatchObject({ kind: "category", from: w.from, to: TODAY });
    const food = data.transactions.filter((t) => t.category === "food" && t.date >= w.from && t.date <= TODAY);
    const spent = -food.reduce((s, t) => s + t.amount, 0);
    expect(doc.text).toContain(`Spent on Food & dining: ${money(spent)} over 12 months`);
    const listed = doc.text.split("\n").filter((l) => l.startsWith("- 20") && l.includes("| id "));
    expect(listed.length).toBe(Math.min(food.length, DOC_TRANSACTIONS_MAX));
    if (food.length > DOC_TRANSACTIONS_MAX) expect(doc.text).toContain(`the newest ${DOC_TRANSACTIONS_MAX} are listed`);
    for (const l of listed) expect(l).toContain("| Food & dining |");
  });

  it("cites every charge from a merchant within the twelve months its link shows, and only theirs", () => {
    const data = demo();
    const w = monthWindow(TODAY, 12);
    const doc = read("merchant:green basket market", data)!;
    const ever = data.transactions.filter((t) => t.merchant.toLowerCase() === "green basket market");
    const theirs = ever.filter((t) => t.date >= w.from && t.date <= TODAY);
    // Some fall before the window, so leaving them out is tested too.
    expect(ever.length).toBeGreaterThan(theirs.length);
    for (const t of theirs) expect(doc.text).toContain(`| id ${t.id}`);
    const listed = doc.text.split("\n").filter((l) => l.includes("| id "));
    expect(listed.length).toBe(theirs.length);
    expect(doc.metadata).toMatchObject({ kind: "merchant", from: w.from, to: TODAY });
  });

  it("answers null for an id that names nothing, however it's dressed", () => {
    for (const id of [
      "",
      "nope",
      "month:2019-01",
      "month:2026-13",
      "year:1999",
      "category:income",
      "category:__proto__",
      "merchant:",
      "merchant:nobody at all",
      "__proto__",
      "constructor",
      "overview ",
    ]) {
      expect(read(id)).toBeNull();
    }
  });

  it("never changes the data it is handed", () => {
    const data = demo();
    const before = structuredClone(data);
    researchSearch(data, SITE, "green basket 2025 groceries");
    for (const id of ["overview", "month:2026-08", "year:2025", "category:food", "merchant:green basket market", "bills"]) read(id, data);
    expect(data).toEqual(before);
  });
});
