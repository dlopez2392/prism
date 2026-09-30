import { describe, expect, it } from "vitest";
import { buildDemoData } from "@/lib/finance/demo";
import { analyze } from "@/lib/finance/model";
import { addDays } from "@/lib/finance/dates";
import {
  budgets,
  cashFlow,
  citeable,
  goals,
  listAccounts,
  netWorth,
  overview,
  searchTransactions,
  SEARCH_LIMIT_MAX,
  spendingBreakdown,
  upcomingBills,
  usd,
  type AgentData,
} from "./tools";

const TODAY = "2026-09-18";
const demo = (): AgentData => ({ ...buildDemoData(TODAY), demo: true, notice: null, timeZone: "America/Chicago", budgetsSetByPerson: false });
const live = (): AgentData => ({ ...demo(), demo: false, notice: "Chase needs you to sign in again." });
const ids = (data: AgentData) => new Set(data.transactions.map((t) => t.id));

describe("every result", () => {
  it("says what day it is, in whose calendar, and whether the money is real", () => {
    const d = overview(demo());
    expect(d).toMatchObject({ as_of: TODAY, time_zone: "America/Chicago", currency: "USD", demo: true });
    expect(d.demo_note).toMatch(/not the user's money/);
    const l = overview(live());
    expect(l.demo).toBe(false);
    expect("demo_note" in l).toBe(false);
    expect(l.notice).toBe("Chase needs you to sign in again.");
  });

  it("never changes the data it is handed, and stays a modest size", () => {
    const data = demo();
    const before = structuredClone(data);
    const results = [
      overview(data),
      listAccounts(data),
      searchTransactions(data, {}),
      spendingBreakdown(data, {}),
      cashFlow(data, {}),
      budgets(data),
      goals(data),
      upcomingBills(data, {}),
      netWorth(data),
    ];
    expect(data).toEqual(before);
    for (const r of results) expect(JSON.stringify(r).length).toBeLessThan(40_000);
  });
});

describe("get_overview", () => {
  it("reports the same numbers the app's own analysis does", () => {
    const data = demo();
    const a = analyze(data);
    const o = overview(data);
    expect(o.this_month.spent_so_far).toBe(usd(a.spentMTD));
    expect(o.this_month.income_so_far).toBe(usd(a.incomeMTD));
    expect(o.net_worth?.now).toBe(usd(a.netWorth.at(-1)!.net));
    expect(o.safe_to_spend?.amount).toBe(usd(a.safe!.amount));
    expect(o.greeting_name).toBe("Alex");
  });

  it("backs each insight with transactions that really exist", () => {
    const data = demo();
    const known = ids(data);
    const o = overview(data);
    expect(o.insights.length).toBeGreaterThan(0);
    for (const i of o.insights) for (const t of i.evidence) expect(known.has(t.id)).toBe(true);
  });
});

describe("search_transactions", () => {
  it("defaults to the last 30 days, newest first, and says when there is more", () => {
    const r = searchTransactions(demo(), {});
    expect(r.from).toBe(addDays(TODAY, -29));
    expect(r.to).toBe(TODAY);
    expect(r.transactions.length).toBe(25);
    expect(r.matched).toBeGreaterThan(25);
    expect(r.more).toBeDefined();
    const dates = r.transactions.map((t) => t.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    for (const t of r.transactions) expect(t.date >= r.from && t.date <= r.to).toBe(true);
  });

  it("finds a merchant however it is typed, and totals every match, not just the ones shown", () => {
    const data = demo();
    const merchant = data.transactions.filter((t) => t.amount < 0).at(-1)!.merchant;
    const r = searchTransactions(data, { query: merchant.toUpperCase(), from: addDays(TODAY, -365), limit: 1 });
    expect(r.matched).toBeGreaterThan(0);
    expect(r.transactions.every((t) => t.merchant === merchant)).toBe(true);
    const all = data.transactions.filter((t) => t.merchant === merchant && t.date >= addDays(TODAY, -365));
    expect(r.total_out).toBe(usd(all.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0)));
  });

  it("filters by category, direction, account and size", () => {
    const data = demo();
    const food = searchTransactions(data, { category: "food", limit: SEARCH_LIMIT_MAX });
    expect(food.transactions.every((t) => t.category === "Food & dining")).toBe(true);
    const inflow = searchTransactions(data, { direction: "in", limit: SEARCH_LIMIT_MAX });
    expect(inflow.transactions.every((t) => t.amount > 0)).toBe(true);
    const big = searchTransactions(data, { direction: "out", min_amount: 100, max_amount: 500, limit: SEARCH_LIMIT_MAX });
    expect(big.transactions.every((t) => t.amount <= -100 && t.amount >= -500)).toBe(true);
    const acct = data.accounts.find((a) => a.kind === "checking")!;
    const own = searchTransactions(data, { account_id: acct.id, limit: SEARCH_LIMIT_MAX });
    expect(own.matched).toBeGreaterThan(0);
    expect(own.transactions.every((t) => t.account.startsWith(acct.name))).toBe(true);
  });

  it("keeps the limit and the dates within bounds", () => {
    const data = demo();
    expect(searchTransactions(data, { limit: 10_000 }).transactions.length).toBeLessThanOrEqual(SEARCH_LIMIT_MAX);
    expect(searchTransactions(data, { limit: 0 }).transactions.length).toBe(1);
    // A future end is today; a backwards range is put the right way round.
    expect(searchTransactions(data, { to: "2030-01-01" }).to).toBe(TODAY);
    const swapped = searchTransactions(data, { from: TODAY, to: addDays(TODAY, -10) });
    expect([swapped.from, swapped.to]).toEqual([addDays(TODAY, -10), TODAY]);
    const future = searchTransactions(data, { from: "2030-01-01" });
    expect([future.from, future.to]).toEqual([TODAY, TODAY]);
  });
});

describe("spending_breakdown", () => {
  it("defaults to this month so far, and its categories add up to the total", () => {
    const r = spendingBreakdown(demo(), {});
    expect(r.from).toBe("2026-09-01");
    expect(r.to).toBe(TODAY);
    const sum = r.categories.reduce((s, c) => s + Math.round(c.spent * 100), 0);
    expect(sum / 100).toBeCloseTo(r.total_spent, 2);
  });

  it("names the biggest charges in each category, from inside the range", () => {
    const data = demo();
    const known = ids(data);
    const r = spendingBreakdown(data, { from: "2026-08-01", to: "2026-08-31" });
    expect(r.compared_with).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    for (const c of r.categories) {
      expect(c.largest.length).toBeGreaterThan(0);
      for (const t of c.largest) {
        expect(known.has(t.id)).toBe(true);
        expect(t.category).toBe(c.category);
        expect(t.date >= "2026-08-01" && t.date <= "2026-08-31").toBe(true);
      }
    }
  });
});

describe("get_cash_flow", () => {
  it("gives whole months, marks the one still running, and caps the history", () => {
    const r = cashFlow(demo(), { months: 3 });
    expect(r.months.map((m) => m.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(r.months.at(-1)!.partial).toBe(true);
    expect("partial" in r.months[0]!).toBe(false);
    expect(cashFlow(demo(), { months: 99 }).months).toHaveLength(13);
  });
});

describe("get_budgets and get_goals", () => {
  it("say who set the budgets", () => {
    expect(budgets(demo()).set_by).toMatch(/suggested/);
    expect(budgets({ ...demo(), budgetsSetByPerson: true }).set_by).toBe("the user");
  });

  it("carry every budget and goal the person has", () => {
    const data = demo();
    expect(budgets(data).budgets).toHaveLength(data.budgets.length);
    const g = goals(data);
    expect(g.goals).toHaveLength(data.goals.length);
    for (const x of g.goals) expect(typeof x.on_track).toBe("boolean");
    expect(g.goals.every((x) => x.follows_account === null)).toBe(true);
  });

  it("say which account a goal's savings follow, and when that account is gone", () => {
    const data = demo();
    const savings = data.accounts.find((a) => a.kind === "savings")!;
    const [first, second, ...rest] = data.goals;
    const g = goals({ ...data, goals: [{ ...first!, accountId: savings.id }, { ...second!, accountId: "gone" }, ...rest] });
    expect(g.goals.map((x) => x.follows_account).slice(0, 2)).toEqual([savings.name, "an account that isn't connected any more"]);
  });
});

describe("upcoming_bills", () => {
  it("lists what is due after today and within the window, soonest first, drawn from real charges", () => {
    const data = demo();
    const known = ids(data);
    const r = upcomingBills(data, { days: 30 });
    expect(r.items.length).toBeGreaterThan(0);
    const dates = r.items.map((i) => i.date);
    expect([...dates].sort()).toEqual(dates);
    for (const i of r.items) {
      expect(i.date > TODAY && i.date <= addDays(TODAY, 30)).toBe(true);
      for (const t of i.based_on) expect(known.has(t.id)).toBe(true);
    }
    expect(upcomingBills(data, { days: 1000 }).to).toBe(addDays(TODAY, 90));
  });
});

describe("get_net_worth", () => {
  it("ends where the overview says it is", () => {
    const data = demo();
    expect(netWorth(data).by_month_end.at(-1)!.net_worth).toBe(overview(data).net_worth!.now);
  });
});

describe("a cited transaction", () => {
  it("names its account by the last four digits and flags a pending charge", () => {
    const account = { id: "a1", institutionId: "i", name: "Everyday Checking", mask: "1234", kind: "checking" as const, balance: 0, history: [], source: "plaid" as const };
    const t = { id: "t1", accountId: "a1", date: TODAY, amount: -1234, merchant: "Corner Café", category: "food" as const, pending: true };
    expect(citeable(t, new Map([["a1", account]]))).toEqual({
      id: "t1",
      date: TODAY,
      merchant: "Corner Café",
      amount: -12.34,
      category: "Food & dining",
      account: "Everyday Checking ••1234",
      pending: true,
    });
  });

  it("says when the person filed it under a category the bank didn't, and what the bank said", () => {
    const t = { id: "t2", accountId: "a1", date: TODAY, amount: -550, merchant: "Blue Bottle", category: "food" as const, bankCategory: "shopping" as const, pending: false };
    expect(citeable(t, new Map())).toMatchObject({ category: "Food & dining", category_set_by_person: true, bank_category: "Shopping" });
    expect(citeable({ ...t, bankCategory: undefined }, new Map())).not.toHaveProperty("bank_category");
  });
});
