import { describe, expect, it } from "vitest";
import { buildDemoData } from "@/lib/finance/demo";
import { analyze } from "@/lib/finance/model";
import { addDays } from "@/lib/finance/dates";
import {
  budgets,
  canIAfford,
  cashFlow,
  citeable,
  goals,
  income,
  listAccounts,
  netWorth,
  overview,
  searchTransactions,
  SEARCH_LIMIT_MAX,
  spendingBreakdown,
  TAX_LINES_MAX,
  taxes,
  planDebtPayoff,
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
      income(data),
      netWorth(data),
      taxes(data),
      canIAfford(data, { kind: "monthly_payment", amount: 450 }),
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

  it("lists every bill that doesn't come monthly, however far off, with what to put aside for it", () => {
    const r = upcomingBills(demo(), { days: 30 });
    expect(r.bills_less_often_than_monthly).toEqual([
      { name: "Clearwater Water & Sewer", amount: -74.8, estimated: true, cadence: "quarterly", next: "2026-10-06", set_aside_per_month: 24.93, account: "Everyday Checking ••4821" },
      { name: "ClearSight Lenses", amount: -96, cadence: "semiannual", next: "2026-11-17", set_aside_per_month: 16, account: "Summit Rewards Visa ••1107" },
      { name: "Parcelpass membership", amount: -139, cadence: "annual", next: "2027-09-01", set_aside_per_month: 11.58, account: "Everyday Checking ••4821" },
    ]);
    expect(r.less_often_set_aside_per_month).toBe(52.51);
    // The one due inside the window is an item too, citing the charges it comes from.
    expect(r.items.find((i) => i.name === "Clearwater Water & Sewer")).toMatchObject({ date: "2026-10-06", cadence: "quarterly", estimated: true });
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

  it("carries what the person added: a split's part, their tags, and who owes them", () => {
    const t = { id: "c1~1", accountId: "a1", date: TODAY, amount: -9_000, merchant: "Costco", category: "food" as const, pending: false, split: { of: "c1", part: 1, parts: 2, total: -15_000 }, tags: ["Party"], owed: { who: "Sam", amount: 7_500, paid: null } };
    expect(citeable(t, new Map())).toMatchObject({ split_by_user: { part: 1, of_parts: 2, whole_transaction_id: "c1", whole_amount: -150 }, tags: ["Party"], owed_to_user: { by: "Sam", amount: 75, paid_back_on: null } });
    const data = { ...demo(), transactions: [...demo().transactions, t] };
    expect(searchTransactions(data, { query: "party", from: TODAY }).transactions.map((x) => x.id)).toEqual(["c1~1"]);
    expect(searchTransactions(data, { query: "sam", from: TODAY }).transactions.map((x) => x.id)).toEqual(["c1~1"]);
  });

  it("says when the person filed it under a category the bank didn't, and what the bank said", () => {
    const t = { id: "t2", accountId: "a1", date: TODAY, amount: -550, merchant: "Blue Bottle", category: "food" as const, bankCategory: "shopping" as const, pending: false };
    expect(citeable(t, new Map())).toMatchObject({ category: "Food & dining", category_set_by_person: true, bank_category: "Shopping" });
    expect(citeable({ ...t, bankCategory: undefined }, new Map())).not.toHaveProperty("bank_category");
  });
});

describe("card and loan terms from the lenders", () => {
  it("ride along with each card and loan in list_accounts", () => {
    const cards = listAccounts(demo()).groups.flatMap((g) => g.accounts).filter((a) => "lender_terms" in a);
    expect(cards.map((a) => a.name)).toEqual(["Summit Rewards Visa", "Auto loan", "Student loan"]);
    expect(cards[0]).toMatchObject({ lender_terms: { due_date: TODAY, minimum_payment: 35, interest_rate_percent: 24.49 } });
    // The demo agrees with itself: the statement is what Alex pays the card on its due date.
    const paid = demo().transactions.find((t) => t.merchant === "Summit Card payment" && t.date === TODAY)!;
    expect((cards[0] as { lender_terms: { statement_balance: number } }).lender_terms.statement_balance).toBe(Math.abs(paid.amount) / 100);
  });

  it("are listed in upcoming_bills as they're due, and not added into money_out a second time", () => {
    const data = demo();
    const r = upcomingBills(data, { days: 30 });
    expect(r.card_and_loan_payments_due.map((p) => [p.date, p.account, p.minimum_payment])).toEqual([
      [TODAY, expect.stringContaining("Summit Rewards Visa"), 35],
      [addDays(TODAY, 7), expect.stringContaining("Student loan"), 210],
      [addDays(TODAY, 26), expect.stringContaining("Auto loan"), 389],
    ]);
    const without = upcomingBills({ ...data, accounts: data.accounts.map((a) => ({ ...a, liability: undefined })) }, { days: 30 });
    expect(without.money_out).toBe(r.money_out);
    expect(without.card_and_loan_payments_due).toEqual([]);
    expect(upcomingBills(data, { days: 10 }).card_and_loan_payments_due).toHaveLength(2);
  });
});

describe("get_income", () => {
  it("names the paycheck, when it comes, what lands and the next payday, citing the deposits", () => {
    const data = demo();
    const r = income(data);
    expect(r).toMatchObject({ as_of: TODAY, demo: true });
    expect(r.paychecks).toHaveLength(1);
    const [p] = r.paychecks;
    expect(p).toMatchObject({ payer: "Lumen Design Co.", kind: "pay", how_often: "Every other Friday", account: "Everyday Checking ••4821" });
    expect(p!.next_payday > TODAY).toBe(true);
    expect(p!.yearly_take_home).toBe(Math.round(p!.take_home * 26 * 100) / 100);
    expect(p!.based_on).toHaveLength(3);
    for (const t of p!.based_on) expect(ids(data).has(t.id)).toBe(true);
    expect(r.next_payday).toEqual({ date: p!.next_payday, amount: p!.take_home, payer: "Lumen Design Co." });
    expect(r.averaged_over_months).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(r.monthly_average_by_kind[0]).toMatchObject({ kind: "pay", label: "Pay" });
    expect(r.monthly_average_total).toBeCloseTo(r.monthly_average_by_kind.reduce((s, k) => s + k.monthly, 0), 2);
  });
});


describe("Venmo, PayPal and Cash App payments", () => {
  const withNote = (): AgentData => {
    const data = live();
    const t = data.transactions.find((x) => x.amount < 0 && x.date >= addDays(TODAY, -20))!;
    Object.assign(t, { merchant: "Venmo", p2p: { app: "venmo", dir: "to", name: "Alex Kim", note: "pizza", date: t.date } });
    return data;
  };

  it("cite who a payment was for and the note, and are found by either", () => {
    const data = withNote();
    const byName = searchTransactions(data, { query: "alex" });
    expect(byName.transactions).toHaveLength(1);
    expect(byName.transactions[0]).toMatchObject({ merchant: "Venmo", payment: { app: "Venmo", who: "To Alex Kim", note: "pizza" } });
    expect(searchTransactions(data, { query: "pizza" }).transactions).toHaveLength(1);
    // A transaction without one says nothing about payments.
    expect(searchTransactions(data, { limit: 100 }).transactions.filter((t) => "payment" in t)).toHaveLength(1);
  });
});

describe("get_tax_summary", () => {
  it("sorts the year into what a return asks about, money out negative, citing each line and the form to trust", () => {
    const data = demo();
    const r = taxes(data, { year: 2026 });
    expect(r).toMatchObject({ as_of: TODAY, demo: true, year: 2026, span: { from: "2026-01-01", to: TODAY, year_under_way: true } });
    expect(r.note).toMatch(/Not tax advice/);
    const by = new Map(r.sections.map((x) => [x.id, x]));
    expect(by.get("interest")).toMatchObject({ money: "in", form: "1099-INT" });
    expect(by.get("interest")!.total).toBeGreaterThan(0);
    expect(by.get("student-loans")).toMatchObject({ money: "out", form: "1098-E" });
    expect(by.get("student-loans")!.total).toBeLessThan(0);
    for (const x of r.sections) {
      expect(x.transactions.length).toBe(Math.min(x.transaction_count, TAX_LINES_MAX));
      for (const t of x.transactions) expect(ids(data).has(t.id)).toBe(true);
    }
    expect(r.nothing_found_for).toContain("Mortgage payments");
  });

  it("caps what it lists, says how many it left out, and says when it answered for another year", () => {
    const data = demo();
    const pay = Array.from({ length: TAX_LINES_MAX + 5 }, (_, i) => ({ id: `p${i}`, accountId: data.accounts[0]!.id, date: addDays("2026-01-01", i), amount: 100_000, merchant: "Acme Payroll", category: "income" as const, pending: false }));
    const r = taxes({ ...data, transactions: [...data.transactions, ...pay] }, { year: 1999 });
    expect(r.year).toBe(2026);
    expect(r.year_note).toMatch(/no records from 1999/);
    const p = r.sections.find((x) => x.id === "pay")!;
    expect(p.transactions).toHaveLength(TAX_LINES_MAX);
    expect(p.not_listed).toBe(p.transaction_count - TAX_LINES_MAX);
  });
});

describe("can_i_afford", () => {
  type Answered = Extract<ReturnType<typeof canIAfford>, { tried: unknown }>;

  it("answers from the same forecast the Future page draws, with the figures before and after", () => {
    const data = demo();
    const a = analyze(data);
    const r = canIAfford(data, { kind: "purchase", amount: 1, date: TODAY }) as Answered;
    expect(r).toMatchObject({ as_of: TODAY, demo: true, tried: { kind: "purchase", amount: 1, date: TODAY }, answer: "fits" });
    expect(r.safe_to_spend_today.before).toBe(usd(a.safe!.amount));
    expect(r.checking_lowest_point.before).toEqual({ date: a.forecast!.lowest.date, balance: usd(a.forecast!.lowest.balance) });
    expect(r.safe_to_spend_today.after).toBe(usd(Math.max(0, a.safe!.amount - 100)));
  });

  it("says no to what checking can't carry, and why", () => {
    const r = canIAfford(demo(), { kind: "purchase", amount: 1_000_000 }) as Answered;
    expect(r.answer).toBe("does_not_fit");
    expect(r.reasons[0]).toMatch(/below zero/);
  });

  it("turns away a date it can't test, and answers plainly without a checking account", () => {
    expect(canIAfford(demo(), { kind: "raise", amount: 500, date: "2020-01-01" })).toMatchObject({ answer: null, note: expect.stringMatching(/a date from 2026-09-18/) });
    const none = { ...demo(), accounts: demo().accounts.filter((x) => x.kind !== "checking") };
    expect(canIAfford(none, { kind: "purchase", amount: 50 })).toMatchObject({ answer: null, note: expect.stringMatching(/No checking account/) });
  });
});

describe("plan_debt_payoff", () => {
  it("plans the two loans with their lenders' terms, both orders and the yardstick, and leaves out the card paid off each month", () => {
    const r = planDebtPayoff(demo(), { extra_per_month: 200 });
    expect(r.debts.map((d) => [d.account, d.kind, d.apr, d.monthly_payment, d.terms_from, d.in_plan])).toEqual([
      ["Auto loan ••3302", "loan", 6.9, 389, "lender", true],
      ["Student loan ••6614", "loan", 5.05, 210, "lender", true],
      ["Summit Rewards Visa ••1107", "card", 24.49, 35, "lender", false],
    ]);
    expect(r.debts[2]).toMatchObject({ left_out: expect.stringMatching(/paid off each month/) });
    expect(r.plans!.highest_rate_first.order.map((o) => o.account)).toEqual(["Auto loan ••3302", "Student loan ••6614"]);
    expect(r.plans!.smallest_balance_first.order.map((o) => o.account)).toEqual(["Student loan ••6614", "Auto loan ••3302"]);
    expect(r.same_order).toBe(false);
    expect(r.plans!.highest_rate_first.interest).toBeLessThan(r.plans!.smallest_balance_first.interest);
    expect(r.plans!.highest_rate_first.months!).toBeLessThan(r.plans!.only_what_each_asks.months!);
    expect(r.plans!.highest_rate_first.debt_free).toMatch(/^\d{4}-\d{2}$/);
    expect(r.method).toMatch(/does not recommend/);
  });

  it("takes the user's own rate, payment and choices over the lender's, and names ids it doesn't know", () => {
    const r = planDebtPayoff(demo(), { debts: [{ account_id: "demo-card", include: true }, { account_id: "demo-auto", monthly_payment: 500 }, { account_id: "nope" }] });
    const card = r.debts.find((d) => d.account_id === "demo-card")!;
    expect(card).toMatchObject({ in_plan: true });
    expect(card).not.toHaveProperty("left_out");
    expect(r.debts.find((d) => d.account_id === "demo-auto")).toMatchObject({ monthly_payment: 500, terms_from: "user" });
    expect(r.unknown_account_ids).toEqual(["nope"]);
    // The card has the highest rate and the smallest balance: first either way.
    expect(r.plans!.highest_rate_first.order[0]!.account).toBe("Summit Rewards Visa ••1107");
  });

  it("asks for what's missing instead of guessing, and says when nothing is owed", () => {
    const data = demo();
    const bare = { ...data, accounts: data.accounts.map((a) => ({ ...a, liability: undefined })) };
    const r = planDebtPayoff(bare, {});
    expect(r.plans).toBeNull();
    expect(r.debts.filter((d) => d.in_plan)).toEqual([]);
    expect(r.debts[0]).toMatchObject({ needs: ["apr", "monthly_payment"], terms_from: null });
    // The card left out of the plan isn't asked about.
    expect(r.debts.find((d) => d.kind === "card")).not.toHaveProperty("needs");
    expect(r.note).toMatch(/Ask the user/);
    const given = planDebtPayoff(bare, { debts: [{ account_id: "demo-student", apr: 5, monthly_payment: 210 }] });
    expect(given.plans!.highest_rate_first.order.map((o) => o.account)).toEqual(["Student loan ••6614"]);
    expect(planDebtPayoff({ ...data, accounts: data.accounts.filter((a) => a.balance >= 0) }, {})).toMatchObject({ debts: [], note: expect.stringMatching(/Nothing is owed/) });
  });
});
