// src/lib/agent/tools.ts
//
// What a connected app (Claude, ChatGPT — anything that speaks MCP) can ask
// Prism, as plain functions over the same analysis every screen draws from,
// so an answer in a chat can never disagree with the app. Pure: no I/O, no
// writes — the MCP endpoint loads the data and hands it in.
//
// House rules for every result: amounts are US dollars as numbers (money out
// negative, money in positive, as on a statement); dates are the person's own
// calendar; every figure that rests on particular transactions carries their
// ids, so the model can cite them; and `demo: true` says, every time, that
// the money is Prism's example household rather than the person's.

import { budgetTotals, daysLeftInMonth } from "@/lib/finance/budgets";
import { categoryBreakdown, inRange, isSpending, monthlyCashFlow, sumIncome, sumSpending, topMerchants } from "@/lib/finance/cashflow";
import { CATEGORIES, isSpendCategory } from "@/lib/finance/categories";
import { addDays, daysBetween, lastMonths, monthKey } from "@/lib/finance/dates";
import { paymentsDue } from "@/lib/finance/debts";
import { analyze } from "@/lib/finance/model";
import { allocation, groupAccounts, projectGoal } from "@/lib/finance/networth";
import { monthlyCost, normalizeMerchant, occurrences } from "@/lib/finance/recurring";
import { P2P_APP_NAMES, p2pLabel } from "@/lib/finance/p2p";
import type { Account, CategoryId, Cents, FinanceData, ISODate, Liability, Transaction } from "@/lib/finance/types";

/** The money a connected app is shown, and what kind of money it is. */
export type AgentData = FinanceData & {
  /** Nothing linked yet: this is Prism's example household, never the person's money. */
  demo: boolean;
  /** Something the person should know about the data (a bank that needs attention…). */
  notice: string | null;
  /** The IANA zone "today" is counted in. */
  timeZone: string;
  /** The person set their own budgets (else they are suggestions drafted from history). */
  budgetsSetByPerson: boolean;
};

export const CATEGORY_IDS = Object.keys(CATEGORIES) as CategoryId[];
export const SEARCH_LIMIT_MAX = 100;
const SEARCH_LIMIT_DEFAULT = 25;
const UPCOMING_DAYS_MAX = 90;

/** Cents → dollars, exact to the cent. */
export const usd = (c: Cents): number => Math.round(c) / 100;

const pct = (ratio: number | null): number | null => (ratio === null || !Number.isFinite(ratio) ? null : Math.round(ratio * 1000) / 10);

function frame(data: AgentData) {
  return {
    as_of: data.today,
    time_zone: data.timeZone,
    currency: "USD" as const,
    demo: data.demo,
    ...(data.demo ? { demo_note: "Example household (Alex Rivera), not the user's money. Nothing is linked to Prism yet." } : {}),
    ...(data.notice ? { notice: data.notice } : {}),
  };
}

function accountLabel(a: Account | undefined): string {
  if (!a) return "Unknown account";
  return a.mask ? `${a.name} ••${a.mask}` : a.name;
}

/** One transaction, shaped to be cited: what, when, how much, where. */
export function citeable(t: Transaction, accounts: Map<string, Account>) {
  return {
    id: t.id,
    date: t.date,
    merchant: t.merchant,
    amount: usd(t.amount),
    category: CATEGORIES[t.category]?.label ?? t.category,
    // The person filed it there themselves; the bank had said otherwise.
    ...(t.bankCategory ? { category_set_by_person: true, bank_category: CATEGORIES[t.bankCategory]?.label ?? t.bankCategory } : {}),
    account: accountLabel(accounts.get(t.accountId)),
    // From the person's own Venmo, PayPal or Cash App file: who it was for, and the note — written by them or the other person.
    ...(t.p2p ? { payment: { app: P2P_APP_NAMES[t.p2p.app], who: p2pLabel(t.p2p), note: t.p2p.note } } : {}),
    ...(t.pending ? { pending: true } : {}),
  };
}

const byId = (data: FinanceData) => new Map(data.accounts.map((a) => [a.id, a]));
const newestFirst = (a: Transaction, b: Transaction) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.amount - a.amount);
const biggestSpendFirst = (a: Transaction, b: Transaction) => a.amount - b.amount;

/** A date range the person asked for, the right way round and never past today; an unset end is today. */
export function dateRange(data: FinanceData, from: ISODate | undefined, to: ISODate | undefined, defaultDays: number): { from: ISODate; to: ISODate } {
  const notAfterToday = (d: ISODate) => (d > data.today ? data.today : d);
  const end = notAfterToday(to ?? data.today);
  const start = from ? notAfterToday(from) : addDays(end, -(defaultDays - 1));
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

// — get_overview ————————————————————————————————————————————————

export function overview(data: AgentData) {
  const a = analyze(data);
  const accounts = byId(data);
  const nw = a.netWorth;
  const now = nw.at(-1);
  const cash = data.accounts.filter((x) => x.kind === "checking" || x.kind === "savings").reduce((s, x) => s + x.balance, 0);
  const soon = addDays(a.today, 14);
  return {
    ...frame(data),
    greeting_name: data.household.firstName,
    net_worth: now
      ? { now: usd(now.net), assets: usd(now.assets), debts: usd(now.debts), change_since_last_month_end: nw.length >= 2 ? usd(now.net - nw.at(-2)!.net) : null }
      : null,
    cash_on_hand: usd(cash),
    this_month: {
      month: monthKey(a.today),
      spent_so_far: usd(a.spentMTD),
      spent_same_point_last_month: usd(a.spentPrevSpan),
      spent_all_of_last_month: usd(a.spentPrevMonth),
      income_so_far: usd(a.incomeMTD),
    },
    safe_to_spend:
      a.safe && a.checking
        ? {
            amount: usd(a.safe.amount),
            until: a.safe.until,
            bills_due_before_then: usd(a.safe.committed),
            cushion_kept: usd(a.safe.cushion),
            checking_account: accountLabel(a.checking),
          }
        : null,
    budgets: {
      over: a.budgets.filter((b) => b.state === "over").map((b) => CATEGORIES[b.category].label),
      at_risk: a.budgets.filter((b) => b.state === "at_risk").map((b) => CATEGORIES[b.category].label),
      total_limit: usd(a.budgetTotals.limit),
      total_spent: usd(a.budgetTotals.spent),
    },
    next_14_days: (a.forecast?.events ?? [])
      .filter((e) => e.date <= soon)
      .map((e) => ({ date: e.date, name: e.merchant, amount: usd(e.amount), kind: e.kind, ...(e.variable ? { estimated: true } : {}) })),
    insights: a.insights.slice(0, 4).map((i) => ({
      title: i.title,
      detail: i.detail,
      evidence: i.evidence
        .map((id) => data.transactions.find((t) => t.id === id))
        .filter((t): t is Transaction => Boolean(t))
        .slice(0, 5)
        .map((t) => citeable(t, accounts)),
    })),
  };
}

// — list_accounts ——————————————————————————————————————————————

/** A card's or a loan's terms as its lender states them (Plaid Liabilities). */
function lenderTerms(l: Liability) {
  return {
    due_date: l.dueDate,
    minimum_payment: l.minimumPayment === null ? null : usd(l.minimumPayment),
    statement_balance: l.statementBalance === null ? null : usd(l.statementBalance),
    interest_rate_percent: l.apr,
    ...(l.overdue ? { overdue: true } : {}),
  };
}

export function listAccounts(data: AgentData) {
  const institutions = new Map(data.institutions.map((i) => [i.id, i]));
  return {
    ...frame(data),
    groups: groupAccounts(data.accounts).map((g) => ({
      group: g.label,
      total: usd(g.total),
      accounts: g.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        institution: institutions.get(a.institutionId)?.name ?? null,
        kind: a.kind,
        mask: a.mask,
        balance: usd(a.balance),
        ...(institutions.get(a.institutionId)?.health === "needs_attention" ? { needs_attention: true } : {}),
        ...(a.liability ? { lender_terms: lenderTerms(a.liability) } : {}),
      })),
    })),
  };
}

// — search_transactions ———————————————————————————————————————————

export type SearchArgs = {
  from?: ISODate;
  to?: ISODate;
  query?: string;
  category?: CategoryId;
  account_id?: string;
  min_amount?: number;
  max_amount?: number;
  direction?: "out" | "in" | "any";
  limit?: number;
};

export function searchTransactions(data: AgentData, args: SearchArgs) {
  const range = dateRange(data, args.from, args.to, 30);
  const accounts = byId(data);
  const needle = args.query ? normalizeMerchant(args.query) : "";
  const raw = args.query?.trim().toLowerCase() ?? "";
  const min = args.min_amount !== undefined ? Math.round(args.min_amount * 100) : null;
  const max = args.max_amount !== undefined ? Math.round(args.max_amount * 100) : null;
  const limit = Math.max(1, Math.min(SEARCH_LIMIT_MAX, Math.floor(args.limit ?? SEARCH_LIMIT_DEFAULT)));

  const matched = data.transactions.filter((t) => {
    if (!inRange(t, range.from, range.to)) return false;
    if (args.category && t.category !== args.category) return false;
    if (args.account_id && t.accountId !== args.account_id) return false;
    if (args.direction === "out" && t.amount >= 0) return false;
    if (args.direction === "in" && t.amount <= 0) return false;
    const size = Math.abs(t.amount);
    if (min !== null && size < min) return false;
    if (max !== null && size > max) return false;
    if (raw && !t.merchant.toLowerCase().includes(raw) && !(needle && normalizeMerchant(t.merchant).includes(needle)) && !(t.p2p && `${t.p2p.name} ${t.p2p.note ?? ""}`.toLowerCase().includes(raw)))
      return false;
    return true;
  });
  const shown = [...matched].sort(newestFirst).slice(0, limit);
  return {
    ...frame(data),
    from: range.from,
    to: range.to,
    matched: matched.length,
    total_out: usd(matched.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0)),
    total_in: usd(matched.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)),
    ...(matched.length > shown.length ? { showing: shown.length, more: "Narrow the dates or add filters to see the rest." } : {}),
    transactions: shown.map((t) => citeable(t, accounts)),
  };
}

// — spending_breakdown ———————————————————————————————————————————

export function spendingBreakdown(data: AgentData, args: { from?: ISODate; to?: ISODate }) {
  const accounts = byId(data);
  const a = analyze(data);
  // Unset: this month so far against the same stretch of last month, as the app shows it.
  const range = args.from || args.to ? dateRange(data, args.from, args.to, 30) : { from: a.mtd.from, to: a.today };
  const span = daysBetween(range.from, range.to) + 1;
  const previous = args.from || args.to ? { from: addDays(range.from, -span), to: addDays(range.from, -1) } : { from: a.mtd.prevFrom, to: a.mtd.prevTo };
  const spend = data.transactions.filter((t) => inRange(t, range.from, range.to) && isSpending(t));

  return {
    ...frame(data),
    from: range.from,
    to: range.to,
    compared_with: previous,
    total_spent: usd(sumSpending(data.transactions, range.from, range.to)),
    total_spent_before: usd(sumSpending(data.transactions, previous.from, previous.to)),
    income: usd(sumIncome(data.transactions, range.from, range.to)),
    categories: categoryBreakdown(data.transactions, range, previous).map((r) => ({
      category: CATEGORIES[r.category].label,
      spent: usd(r.amount),
      share_percent: pct(r.share),
      before: usd(r.previous),
      change_percent: pct(r.change),
      largest: spend
        .filter((t) => t.category === r.category)
        .sort(biggestSpendFirst)
        .slice(0, 3)
        .map((t) => citeable(t, accounts)),
    })),
    top_merchants: topMerchants(data.transactions, range.from, range.to, 8).map((m) => ({
      merchant: m.merchant,
      spent: usd(m.amount),
      visits: m.count,
      category: CATEGORIES[m.category].label,
    })),
  };
}

// — get_cash_flow ————————————————————————————————————————————————

export function cashFlow(data: AgentData, args: { months?: number }) {
  const n = Math.max(1, Math.min(13, Math.floor(args.months ?? 6)));
  const current = monthKey(data.today);
  return {
    ...frame(data),
    months: monthlyCashFlow(data.transactions, lastMonths(data.today, n)).map((m) => ({
      month: m.month,
      income: usd(m.income),
      spending: usd(m.spending),
      net: usd(m.net),
      savings_rate_percent: pct(m.savingsRate),
      ...(m.month === current ? { partial: true } : {}),
    })),
  };
}

// — get_budgets ————————————————————————————————————————————————

export function budgets(data: AgentData) {
  const a = analyze(data);
  const totals = budgetTotals(a.budgets);
  return {
    ...frame(data),
    month: monthKey(a.today),
    days_left_in_month: daysLeftInMonth(a.today),
    set_by: data.budgetsSetByPerson ? "the user" : "Prism (suggested from recent spending)",
    total_limit: usd(totals.limit),
    total_spent: usd(totals.spent),
    budgets: a.budgets.map((b) => ({
      category: CATEGORIES[b.category].label,
      limit: usd(b.limit),
      spent: usd(b.spent),
      remaining: usd(b.remaining),
      projected_month_end: usd(b.projected),
      used_percent: pct(b.used),
      status: b.state,
    })),
  };
}

// — get_goals ——————————————————————————————————————————————————

export function goals(data: AgentData) {
  return {
    ...frame(data),
    goals: data.goals.map((g) => {
      const p = projectGoal(g, data.today);
      return {
        name: g.name,
        emoji: g.emoji,
        target: usd(g.target),
        saved: usd(g.saved),
        progress_percent: pct(p.progress),
        monthly_contribution: usd(g.monthlyContribution),
        target_date: g.targetDate,
        projected_finish: p.projectedDate,
        on_track: p.onTrack,
        monthly_needed_to_hit_target_date: usd(p.neededMonthly),
        // "saved" is that account's balance when the goal follows one; otherwise the person typed it.
        follows_account: g.accountId ? (data.accounts.find((a) => a.id === g.accountId)?.name ?? "an account that isn't connected any more") : null,
      };
    }),
  };
}

// — get_income ————————————————————————————————————————————————

export function income(data: AgentData) {
  const s = analyze(data).income;
  const accounts = byId(data);
  const txById = new Map(data.transactions.map((t) => [t.id, t]));
  return {
    ...frame(data),
    paychecks: s.paychecks.map((p) => ({
      payer: p.payer,
      kind: p.kind,
      how_often: p.when,
      take_home: usd(p.takeHome),
      ...(p.variable ? { amount_varies: true } : {}),
      yearly_take_home: usd(p.yearly),
      last_paid: p.lastDate,
      // Moved to the business day before when banks are closed that day.
      next_payday: p.next,
      account: accountLabel(accounts.get(p.accountId)),
      ...(p.change ? { pay_changed: { from: usd(p.change.from), to: usd(p.change.to), on: p.change.date } } : {}),
      // The latest deposits it was found from.
      based_on: p.transactionIds
        .map((id) => txById.get(id))
        .filter((t): t is Transaction => Boolean(t))
        .sort(newestFirst)
        .slice(0, 3)
        .map((t) => citeable(t, accounts)),
    })),
    // A year of paydays, and that year spread evenly over twelve months (a month itself holds two or three biweekly ones).
    paychecks_per_year: usd(s.paychecks.reduce((sum, p) => sum + p.yearly, 0)),
    paychecks_per_month: usd(s.steadyMonthly),
    next_payday: s.next ? { date: s.next.date, amount: usd(s.next.amount), payer: s.next.payer } : null,
    // Everything that came in, pay included, as a monthly average over these full months.
    averaged_over_months: s.months,
    monthly_average_by_kind: s.byKind.map((k) => ({ kind: k.kind, label: k.label, monthly: usd(k.monthly) })),
    monthly_average_total: usd(s.monthly),
  };
}

// — upcoming_bills —————————————————————————————————————————————

export function upcomingBills(data: AgentData, args: { days?: number }) {
  const a = analyze(data);
  const accounts = byId(data);
  const days = Math.max(1, Math.min(UPCOMING_DAYS_MAX, Math.floor(args.days ?? 30)));
  const from = addDays(a.today, 1);
  const to = addDays(a.today, days);
  const txById = new Map(data.transactions.map((t) => [t.id, t]));

  const items = a.streams
    .filter((s) => s.kind !== "transfer")
    .flatMap((s) =>
      occurrences(s, from, to).map((date) => ({
        date,
        name: s.merchant,
        amount: usd(s.amount),
        kind: s.kind,
        cadence: s.cadence,
        account: accountLabel(accounts.get(s.accountId)),
        ...(s.variable ? { estimated: true } : {}),
        ...(s.priceChange ? { price_changed: { from: usd(s.priceChange.from), to: usd(s.priceChange.to), on: s.priceChange.date } } : {}),
        // The last charges this expectation is drawn from.
        based_on: s.transactionIds
          .map((id) => txById.get(id))
          .filter((t): t is Transaction => Boolean(t))
          .sort(newestFirst)
          .slice(0, 2)
          .map((t) => citeable(t, accounts)),
      })),
    )
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));

  const subscriptions = a.streams.filter((s) => s.kind === "subscription");
  const lowest = a.forecast?.lowest;
  return {
    ...frame(data),
    from,
    to,
    money_out: usd(items.filter((i) => i.amount < 0).reduce((s, i) => s + Math.round(i.amount * 100), 0)),
    money_in: usd(items.filter((i) => i.amount > 0).reduce((s, i) => s + Math.round(i.amount * 100), 0)),
    items,
    // From the lenders, not from spending patterns — and not added into money_out, because the checking
    // account's usual card payment is already counted there when Prism has seen it repeat.
    card_and_loan_payments_due: paymentsDue(data.accounts, a.today, days).map(({ account, liability }) => ({
      date: liability.dueDate,
      account: accountLabel(account),
      ...lenderTerms(liability),
    })),
    subscriptions_per_month: usd(subscriptions.reduce((s, x) => s + monthlyCost(x), 0)),
    ...(lowest && a.checking && lowest.date <= to
      ? { lowest_expected_checking_balance: { amount: usd(lowest.balance), date: lowest.date, account: accountLabel(a.checking) } }
      : {}),
  };
}

// — get_net_worth ——————————————————————————————————————————————

export function netWorth(data: AgentData) {
  const a = analyze(data);
  const holdingsTotal = data.holdings.reduce((s, h) => s + h.value, 0);
  return {
    ...frame(data),
    by_month_end: a.netWorth.map((p) => ({ month: p.month, net_worth: usd(p.net), assets: usd(p.assets), debts: usd(p.debts) })),
    groups: groupAccounts(data.accounts).map((g) => ({ group: g.label, total: usd(g.total) })),
    investments:
      holdingsTotal > 0
        ? {
            total: usd(holdingsTotal),
            allocation: allocation(data.holdings).map((x) => ({ asset_class: x.assetClass, value: usd(x.value), share_percent: pct(x.share) })),
            largest_holdings: [...data.holdings]
              .sort((x, y) => y.value - x.value)
              .slice(0, 10)
              .map((h) => ({ symbol: h.symbol, name: h.name, value: usd(h.value), gain: usd(h.value - h.costBasis) })),
          }
        : null,
  };
}

/** Spending categories a model may filter on, by their labels — for tool descriptions. */
export const SPEND_CATEGORY_HELP = CATEGORY_IDS.filter((c) => isSpendCategory(c))
  .map((c) => `${c} (${CATEGORIES[c].label})`)
  .join(", ");
