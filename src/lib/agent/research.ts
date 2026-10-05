// src/lib/agent/research.ts
//
// ChatGPT's deep research (and its company knowledge) reads a connector
// through exactly two tools: `search`, which answers with documents (an id, a
// title and a link), and `fetch`, which returns one document's full text.
// This is the person's money as that library: the summaries the other tools
// already give (overview, accounts, net worth, spending, cash flow, budgets,
// goals, bills, income), each month and each year, each year's taxes, and each
// spending category and each merchant of the last twelve months.
//
// Every document is drawn from the same functions as the other tools and the
// screens, so a research report can never disagree with the app; and every one
// links to the page in Prism that shows the same figures, so each citation can
// be checked by opening it. A document says only what its page shows: a
// category or a merchant covers the twelve months the Spending page's 12M view
// does. What to look for travels in the link's #fragment, which a browser never
// sends to a server, so no merchant name lands in a request log.
//
// Pure, like tools.ts: no I/O, no writes.

import { categoryTotals, inRange, isSpending, monthlyCashFlow, topMerchants } from "@/lib/finance/cashflow";
import { CATEGORIES, SPEND_CATEGORIES } from "@/lib/finance/categories";
import { addMonths, daysInMonth, monthKey, startOfMonth } from "@/lib/finance/dates";
import { money } from "@/lib/finance/format";
import { p2pLabel } from "@/lib/finance/p2p";
import { normalizeMerchant } from "@/lib/finance/recurring";
import { defaultTaxYear, taxSummary } from "@/lib/finance/taxes";
import type { Account, Cents, ISODate, SpendCategoryId, Transaction } from "@/lib/finance/types";
import { ledgerHash, monthWindow, type LedgerNarrowing } from "@/lib/finance/view";
import { reviewYears, yearReview } from "@/lib/finance/year";
import { budgets, cashFlow, goals, income, listAccounts, netWorth, overview, spendingBreakdown, TAX_NOTE, upcomingBills, type AgentData } from "./tools";

export type ResearchHit = { id: string; title: string; url: string };
export type ResearchDoc = ResearchHit & { text: string; metadata: Record<string, string | number | boolean> };

/** What one search returns at most: deep research reads several, and asks again. */
export const RESEARCH_RESULTS_MAX = 10;
/** The longest list of transactions one document carries; the rest are counted, and the link shows them. */
export const DOC_TRANSACTIONS_MAX = 250;
/** Categories and merchants cover what the Spending page's 12M view shows. */
const RECENT_MONTHS = 12;

// — The summaries ——————————————————————————————————————————————————

type Summary = { id: string; title: string; path: string; words: string[]; build: (d: AgentData) => Record<string, unknown> };

const SUMMARIES: Summary[] = [
  {
    id: "overview",
    title: "Money at a glance",
    path: "/",
    words: ["overview", "summary", "glance", "today", "health", "financial", "finances", "money", "picture", "snapshot", "safe", "insights", "doing"],
    build: overview,
  },
  {
    id: "spending",
    title: "Spending this month",
    path: "/spending",
    words: ["spending", "spend", "spent", "expenses", "expense", "where", "went", "categories", "merchants"],
    build: (d) => spendingBreakdown(d, {}),
  },
  {
    id: "cash-flow",
    title: "Income and spending by month",
    path: "/cash-flow",
    words: ["cash", "flow", "cashflow", "savings", "rate", "saved", "save", "monthly", "trend", "kept", "surplus", "deficit"],
    build: (d) => cashFlow(d, { months: 13 }),
  },
  {
    id: "budgets",
    title: "This month's budgets",
    path: "/budgets",
    words: ["budget", "budgets", "limit", "limits", "overspending", "overspent", "track"],
    build: budgets,
  },
  {
    id: "bills",
    title: "Bills, subscriptions and paydays ahead",
    path: "/future",
    words: ["bills", "bill", "upcoming", "subscriptions", "subscription", "recurring", "due", "paydays", "forecast", "future", "next", "lowest"],
    build: (d) => upcomingBills(d, { days: 90 }),
  },
  {
    id: "accounts",
    title: "Accounts and balances",
    path: "/net-worth",
    words: [
      "accounts",
      "account",
      "balances",
      "balance",
      "bank",
      "banks",
      "checking",
      "credit",
      "card",
      "cards",
      "loan",
      "loans",
      "mortgage",
      "apr",
      "interest",
      "minimum",
    ],
    build: listAccounts,
  },
  {
    id: "net-worth",
    title: "Net worth over the past year",
    path: "/net-worth",
    words: [
      "net",
      "worth",
      "wealth",
      "assets",
      "debts",
      "debt",
      "investments",
      "investment",
      "portfolio",
      "holdings",
      "stocks",
      "allocation",
      "retirement",
      "crypto",
    ],
    build: netWorth,
  },
  {
    id: "goals",
    title: "Savings goals",
    path: "/goals",
    words: ["goal", "goals", "saving", "target", "emergency", "fund", "vacation"],
    build: goals,
  },
  {
    id: "income",
    title: "Income and paychecks",
    path: "/cash-flow",
    words: ["income", "paycheck", "paychecks", "salary", "pay", "payday", "wages", "employer", "earn", "earnings", "raise", "dividends"],
    build: income,
  },
];

/** The words a person uses for each spending category, beyond its own name. */
const CATEGORY_WORDS: Record<SpendCategoryId, string[]> = {
  housing: ["housing", "rent", "mortgage", "home", "house", "apartment", "landlord"],
  food: ["food", "dining", "restaurants", "restaurant", "groceries", "grocery", "eating", "takeout", "coffee", "delivery"],
  transport: ["transport", "transportation", "gas", "fuel", "car", "auto", "parking", "tolls", "transit", "rideshare"],
  shopping: ["shopping", "clothes", "clothing", "retail", "stores", "online"],
  fun: ["fun", "entertainment", "streaming", "movies", "games", "hobbies", "concerts"],
  health: ["health", "medical", "doctor", "pharmacy", "fitness", "gym", "dental"],
  travel: ["travel", "flights", "flight", "hotel", "hotels", "airline", "trips", "trip"],
  bills: ["bills", "utilities", "utility", "electric", "electricity", "water", "internet", "phone", "insurance"],
  other: ["other", "miscellaneous", "uncategorized"],
};

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const STOPWORDS = new Set(
  "a an and are at be by did do does for from how i in is it me much my of on or our over per show so than that the this to was we were what when where which who why with you your all any about many have has had get give tell".split(
    " ",
  ),
);

// — Ids and links ——————————————————————————————————————————————————

const monthTitle = (m: string, today: ISODate) =>
  `${capital(MONTH_NAMES[Number(m.slice(5, 7)) - 1]!)} ${m.slice(0, 4)}${m === monthKey(today) ? " (so far)" : ""}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A merchant's id: its name as Prism groups it (store numbers dropped), clipped so the id stays short. */
const merchantKey = (merchant: string) => normalizeMerchant(merchant).slice(0, 120);

/** The Spending page's 12M view, its ledger narrowed in the #fragment: never sent to the server. */
const ledgerPath = (narrow: LedgerNarrowing) => `/spending?range=${RECENT_MONTHS}${ledgerHash(narrow)}`;

// — The library ————————————————————————————————————————————————————

type Entry = ResearchHit & { kind: "summary" | "month" | "year" | "taxes" | "category" | "merchant"; words: string[] };

/** Words that ask about taxes: they find a year's tax summary, that year's when the question names one. */
const TAX_WORDS = ["tax", "taxes", "taxable", "irs", "deduction", "deductions", "deductible", "deduct", "itemize", "itemized", "charity", "charitable", "donation", "donations", "1099", "1098", "w2", "refund", "refunds"];

/** The span categories and merchants cover: the Spending page's 12M view. */
const recent = (d: AgentData) => monthWindow(d.today, RECENT_MONTHS);
const seen = (d: AgentData) => d.transactions.filter((t) => t.date <= d.today);

function months(d: AgentData): string[] {
  const keys = new Set(seen(d).map((t) => monthKey(t.date)));
  return [...keys].sort().reverse();
}

/** Every merchant of the last twelve months, by its key: the name shown is the latest one used. */
function merchants(d: AgentData): Map<string, { name: string; latest: ISODate; txns: Transaction[] }> {
  const w = recent(d);
  const out = new Map<string, { name: string; latest: ISODate; txns: Transaction[] }>();
  for (const t of seen(d)) {
    if (!inRange(t, w.from, w.to)) continue;
    const key = merchantKey(t.merchant);
    if (!key) continue;
    const row = out.get(key) ?? { name: t.merchant, latest: t.date, txns: [] };
    row.txns.push(t);
    if (t.date >= row.latest) Object.assign(row, { name: t.merchant, latest: t.date });
    out.set(key, row);
  }
  return out;
}

function library(d: AgentData, site: string): Entry[] {
  const url = (path: string) => `${site}${path}`;
  const entries: Entry[] = SUMMARIES.map((s) => ({ id: s.id, title: s.title, url: url(s.path), kind: "summary", words: s.words }));
  for (const m of months(d)) {
    entries.push({ id: `month:${m}`, title: monthTitle(m, d.today), url: url(`/year?y=${m.slice(0, 4)}`), kind: "month", words: [] });
  }
  for (const y of reviewYears(d)) {
    entries.push({
      id: `year:${y}`,
      title: `${y}${String(y) === d.today.slice(0, 4) ? " so far" : ""}: the year in review`,
      url: url(`/year?y=${y}`),
      kind: "year",
      words: [],
    });
  }
  for (const y of reviewYears(d)) {
    entries.push({
      id: `taxes:${y}`,
      title: `${y}${String(y) === d.today.slice(0, 4) ? " so far" : ""}: for your taxes`,
      url: url(`/taxes?y=${y}`),
      kind: "taxes",
      words: TAX_WORDS,
    });
  }
  for (const c of SPEND_CATEGORIES) {
    entries.push({
      id: `category:${c}`,
      title: `${CATEGORIES[c].label}: the last ${RECENT_MONTHS} months`,
      url: url(ledgerPath({ category: c })),
      kind: "category",
      words: CATEGORY_WORDS[c],
    });
  }
  for (const [key, m] of merchants(d)) {
    // Venmo, PayPal and Cash App lines name who they were for, so "alex" finds the payments to Alex.
    const people = [...new Set(m.txns.flatMap((t) => (t.p2p && t.p2p.dir !== "transfer" ? words(t.p2p.name) : [])))].slice(0, 200);
    entries.push({
      id: `merchant:${key}`,
      title: `${m.name}: the last ${RECENT_MONTHS} months`,
      url: url(ledgerPath({ find: key })),
      kind: "merchant",
      words: [...words(key), ...people],
    });
  }
  return entries;
}

// — search ————————————————————————————————————————————————————————

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** How well one word of the question names one of a summary's or a category's: the same word, or a plural or a prefix away. */
function wordScore(token: string, word: string): number {
  if (token === word) return 3;
  if (token.length >= 4 && word.length >= 4 && (word.startsWith(token) || token.startsWith(word))) return 2;
  return 0;
}

/** Words that name a topic: asked alone ("food", "rent"), they mean the category or the summary, not a merchant that happens to use them. */
const TOPIC_WORDS = new Set([...SUMMARIES.flatMap((s) => s.words), ...Object.values(CATEGORY_WORDS).flat()]);

/**
 * A merchant is a name, not a topic: the same word counts (less when it's a
 * topic's word, so "food" finds Food & dining before a food bank), or the
 * start of one ("starbuck", "amaz"), but never a stem of the question's word,
 * or "foods" would find the food bank too.
 */
function nameScore(token: string, word: string): number {
  if (token === word) return TOPIC_WORDS.has(token) ? 2 : 5;
  if (token.length >= 4 && word.startsWith(token)) return 2;
  return 0;
}

/**
 * Documents for a research question, best first. A month or a year the
 * question names comes first, then the merchants and categories it names,
 * then the summaries; a question that names nothing Prism has gets the
 * summaries and this month, which answer most questions about money.
 */
export function researchSearch(d: AgentData, site: string, query: string): { results: ResearchHit[] } {
  const entries = library(d, site);
  const q = query.toLowerCase();
  const tokens = words(q).filter((t) => !STOPWORDS.has(t));
  const scores = new Map<string, number>();
  const add = (id: string, n: number) => {
    if (n > 0) scores.set(id, (scores.get(id) ?? 0) + n);
  };

  // Dates: "2025", "March 2026", "2026-03", "this month", "last year".
  const known = new Set(entries.map((e) => e.id));
  const thisMonth = monthKey(d.today);
  const thisYear = Number(d.today.slice(0, 4));
  const years = tokens.filter((t) => /^(19|20)\d{2}$/.test(t)).map(Number);
  const named = tokens.map((t) => MONTH_NAMES.findIndex((m) => t.length >= 3 && m.startsWith(t))).filter((i) => i >= 0);
  const dated: string[] = [...q.matchAll(/\b((?:19|20)\d{2})-(0[1-9]|1[0-2])\b/g)].map((m) => `${m[1]}-${m[2]}`);
  if (/\b(this|current)\s+month\b/.test(q)) dated.push(thisMonth);
  if (/\b(last|previous)\s+month\b/.test(q)) dated.push(monthKey(addMonths(startOfMonth(d.today), -1)));
  for (const i of named) {
    const mm = String(i + 1).padStart(2, "0");
    const inYears = years.length
      ? years
      : months(d)
          .filter((m) => m.endsWith(`-${mm}`))
          .map((m) => Number(m.slice(0, 4)));
    // Without a year, the latest of that month that Prism holds.
    for (const y of years.length ? inYears : inYears.slice(0, 1)) dated.push(`${y}-${mm}`);
  }
  for (const m of dated) add(`month:${m}`, 10);
  if (!named.length && !dated.length) for (const y of years) add(`year:${y}`, 10);
  if (/\b(this|current)\s+year\b/.test(q)) add(`year:${thisYear}`, 10);
  if (/\b(last|previous)\s+year\b/.test(q)) add(`year:${thisYear - 1}`, 10);

  // Taxes: the year the question names (or "last year"), else the year a person most likely means; above that year's review.
  const taxed = tokens.reduce((s, t) => s + Math.max(0, ...TAX_WORDS.map((w) => wordScore(t, w))), 0);
  if (taxed > 0) {
    const asked = [...years, ...(/\b(this|current)\s+year\b/.test(q) ? [thisYear] : []), ...(/\b(last|previous)\s+year\b/.test(q) ? [thisYear - 1] : [])];
    for (const y of asked.length ? asked : [defaultTaxYear(d)]) add(`taxes:${y}`, 10 + taxed);
  }

  // Names: a merchant or a category the question names outranks the summaries a word like "spend" also names.
  const phrase = tokens.filter((t) => !/^\d+$/.test(t)).join(" ");
  for (const e of entries) {
    if (e.kind === "month" || e.kind === "year" || e.kind === "taxes") continue;
    const score = e.kind === "merchant" ? nameScore : wordScore;
    let s = 0;
    for (const t of tokens) s += Math.max(0, ...e.words.map((w) => score(t, w)));
    // Two or more of a merchant's words in a row ("green basket") beat the same words apart.
    if (e.kind === "merchant" && phrase.includes(" ") && ` ${e.words.join(" ")} `.includes(` ${phrase} `)) s += 6;
    if (e.kind === "category" && s > 0) s += 1;
    add(e.id, s);
  }

  const order = new Map(entries.map((e, i) => [e.id, i]));
  const ranked = [...scores]
    .filter(([id]) => known.has(id))
    .sort((a, b) => b[1] - a[1] || order.get(a[0])! - order.get(b[0])!)
    .map(([id]) => id);
  const ids = ranked.length ? ranked : [...SUMMARIES.map((s) => s.id), `month:${thisMonth}`].filter((id) => known.has(id));
  const byId = new Map(entries.map((e) => [e.id, e]));
  return { results: ids.slice(0, RESEARCH_RESULTS_MAX).map((id) => ({ id, title: byId.get(id)!.title, url: byId.get(id)!.url })) };
}

// — fetch —————————————————————————————————————————————————————————

const FRAME_KEYS = new Set(["as_of", "time_zone", "currency", "demo", "demo_note", "notice"]);
const withoutFrame = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !FRAME_KEYS.has(k)));

const pctText = (ratio: number | null) => (ratio === null || !Number.isFinite(ratio) ? "n/a" : `${Math.round(ratio * 1000) / 10}%`);
const accountLabel = (a: Account | undefined) => (a ? (a.mask ? `${a.name} ••${a.mask}` : a.name) : "Unknown account");
const newestFirst = (a: Transaction, b: Transaction) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.amount - b.amount);

/** One transaction as a line a model can cite: when, who, how much, what, from where, and its id. */
function line(t: Transaction, accounts: Map<string, Account>): string {
  // A payment's name and note were written by other people: quoted, as what they said, never as instructions.
  const paid = t.p2p ? ` | ${p2pLabel(t.p2p)}${t.p2p.note ? `, note "${t.p2p.note.replace(/"/g, "'")}"` : ""}` : "";
  // What an Amazon charge paid for: sellers' words, quoted the same way.
  const bought = t.order ? ` | bought ${t.order.items.map((i) => `"${i.name.replace(/"/g, "'")}"`).join(", ")}` : "";
  return `- ${t.date} | ${t.merchant}${paid}${bought} | ${money(t.amount)} | ${CATEGORIES[t.category]?.label ?? t.category} | ${accountLabel(accounts.get(t.accountId))}${t.pending ? " | pending" : ""} | id ${t.id}`;
}

function ledger(title: string, txns: Transaction[], accounts: Map<string, Account>): string[] {
  const shown = [...txns].sort(newestFirst).slice(0, DOC_TRANSACTIONS_MAX);
  return [
    "",
    `${title} (${txns.length}${txns.length > shown.length ? `; the newest ${shown.length} are listed, the link shows every one` : ""}):`,
    ...shown.map((t) => line(t, accounts)),
  ];
}

function header(d: AgentData, title: string, url: string, span?: { from: ISODate; to: ISODate }): string[] {
  return [
    `Prism: ${title}`,
    `As of ${d.today} (${d.timeZone}). US dollars; in transactions, money out is negative and money in is positive.${span ? ` Covers ${span.from} to ${span.to}.` : ""}`,
    ...(d.demo ? ["IMPORTANT: this is Prism's example household (Alex Rivera), NOT the user's money. Nothing is linked to Prism yet."] : []),
    ...(d.notice ? [`Notice: ${d.notice} Figures may be incomplete.`] : []),
    `Open in Prism: ${url}`,
  ];
}

function monthBody(d: AgentData, m: string, accounts: Map<string, Account>) {
  const from = `${m}-01`;
  const end = `${m}-${String(daysInMonth(from)).padStart(2, "0")}`;
  const to = end > d.today ? d.today : end;
  const txns = seen(d).filter((t) => inRange(t, from, to));
  const flow = monthlyCashFlow(txns, [m])[0]!;
  const cats = categoryTotals(txns, from, to);
  const spend = txns.filter((t) => isSpending(t) && t.amount < 0);
  return {
    span: { from, to },
    text: [
      "",
      `Income: ${money(flow.income)}. Spending: ${money(flow.spending)}. Kept: ${money(flow.net)}. Savings rate: ${pctText(flow.savingsRate)}.`,
      "",
      "Spending by category:",
      ...SPEND_CATEGORIES.filter((c) => cats[c] !== 0)
        .sort((a, b) => cats[b] - cats[a])
        .map((c) => `- ${CATEGORIES[c].label}: ${money(cats[c])}`),
      "",
      "Where the most went:",
      ...topMerchants(txns, from, to, 10).map((r) => `- ${r.merchant}: ${money(r.amount)} over ${r.count} ${r.count === 1 ? "charge" : "charges"}`),
      "",
      "Largest charges:",
      ...[...spend]
        .sort((a, b) => a.amount - b.amount)
        .slice(0, 10)
        .map((t) => line(t, accounts)),
      ...ledger("Every transaction", txns, accounts),
    ],
  };
}

function yearBody(d: AgentData, y: number, accounts: Map<string, Account>) {
  const r = yearReview(d, y);
  const totals = (t: typeof r.totals) =>
    `income ${money(t.income)}, spending ${money(t.spending)}, kept ${money(t.kept)}, savings rate ${pctText(t.savingsRate)}`;
  return {
    span: { from: r.from, to: r.to },
    text: [
      "",
      ...(r.partial ? [`The year is still under way: this counts ${r.from} to ${r.to}.`] : []),
      ...(r.recordsFrom ? [`Prism's records start on ${r.recordsFrom}; nothing earlier in ${y} is counted.`] : []),
      `Totals: ${totals(r.totals)}.`,
      r.before ? `The same span of ${y - 1}: ${totals(r.before)}.` : `No comparison with ${y - 1}: Prism doesn't hold all of that span.`,
      `Paychecks and other pay: ${money(r.pay)}. Transactions counted: ${r.transactions}.`,
      r.netWorth.start !== null || r.netWorth.end !== null
        ? `Net worth: ${r.netWorth.start === null ? "unknown" : money(r.netWorth.start)} before the span, ${r.netWorth.end === null ? "unknown" : money(r.netWorth.end)} at its end.`
        : "Net worth: not known for this span.",
      "",
      "Month by month:",
      ...r.months.map((f) => `- ${f.month}: income ${money(f.income)}, spending ${money(f.spending)}, kept ${money(f.net)}`),
      ...(r.busiest ? [`Costliest full month: ${r.busiest.month} (${money(r.busiest.spending)}).`] : []),
      ...(r.quietest ? [`Quietest full month: ${r.quietest.month} (${money(r.quietest.spending)}).`] : []),
      "",
      "Spending by category:",
      ...r.categories.map(
        (c) =>
          `- ${CATEGORIES[c.category].label}: ${money(c.amount)} (${pctText(c.share)} of spending)${c.before === null ? "" : `; ${money(c.before)} the year before`}`,
      ),
      "",
      "Where the most went:",
      ...r.merchants.map((m) => `- ${m.merchant}: ${money(m.amount)} over ${m.count} ${m.count === 1 ? "charge" : "charges"}`),
      "",
      `Subscriptions: ${r.subscriptions.count}, costing ${money(r.subscriptions.total)} over the span.`,
      ...r.subscriptions.list.map((s) => `- ${s.merchant}: ${money(s.total)}`),
      ...(r.biggest ? ["", "Biggest one-off purchase (never rent, a loan or a subscription):", line(r.biggest, accounts)] : []),
    ],
  };
}

function categoryBody(d: AgentData, c: SpendCategoryId, accounts: Map<string, Account>) {
  const w = recent(d);
  const txns = seen(d).filter((t) => inRange(t, w.from, w.to) && t.category === c && !t.excluded);
  const flows = w.months.map((m) => ({ month: m, spent: -txns.filter((t) => monthKey(t.date) === m).reduce((s, t) => s + t.amount, 0) }));
  const total = flows.reduce((s, f) => s + f.spent, 0);
  return {
    span: { from: w.from, to: w.to },
    text: [
      "",
      `Spent on ${CATEGORIES[c].label}: ${money(total)} over ${RECENT_MONTHS} months (${money(Math.round(total / RECENT_MONTHS))} a month on average; refunds count against spending).`,
      "",
      "Month by month:",
      ...flows.map((f) => `- ${f.month}: ${money(f.spent)}${f.month === monthKey(d.today) ? " (so far)" : ""}`),
      "",
      "Where it went:",
      ...topMerchants(txns, w.from, w.to, 10).map((r) => `- ${r.merchant}: ${money(r.amount)} over ${r.count} ${r.count === 1 ? "charge" : "charges"}`),
      ...ledger("Every transaction", txns, accounts),
    ],
  };
}

function merchantBody(d: AgentData, key: string, accounts: Map<string, Account>) {
  const m = merchants(d).get(key);
  if (!m) return null;
  const w = recent(d);
  const out = m.txns.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0 as Cents);
  const into = m.txns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0 as Cents);
  const byMonth = new Map<string, number>();
  for (const t of m.txns) byMonth.set(monthKey(t.date), (byMonth.get(monthKey(t.date)) ?? 0) + t.amount);
  const dates = m.txns.map((t) => t.date).sort();
  const cats = [...new Set(m.txns.map((t) => CATEGORIES[t.category]?.label ?? t.category))];
  return {
    span: { from: w.from, to: w.to },
    text: [
      "",
      `${m.txns.length} ${m.txns.length === 1 ? "transaction" : "transactions"}, from ${dates[0]} to ${dates.at(-1)}. Money out: ${money(out)}. Money in: ${money(into)}. Filed under: ${cats.join(", ")}.`,
      "",
      "By month (money in less money out):",
      ...[...byMonth].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([month, sum]) => `- ${month}: ${money(sum)}`),
      ...ledger("Every transaction", m.txns, accounts),
    ],
  };
}

/** One document in full, or null when the id names nothing Prism has. */
function taxesBody(d: AgentData, y: number, accounts: Map<string, Account>) {
  const s = taxSummary(d, y);
  const political = s.political.reduce((sum, t) => sum + t.amount, 0);
  return {
    span: { from: s.from, to: s.to },
    text: [
      "",
      TAX_NOTE,
      ...(s.partial ? [`The year is still under way: this counts ${s.from} to ${s.to}.`] : []),
      ...(s.recordsFrom ? [`Prism's records start on ${s.recordsFrom}; nothing earlier in ${y} is counted.`] : []),
      ...s.sections.flatMap((x) => [
        "",
        `${x.title} (money ${x.side}): ${money(x.side === "in" ? x.total : -x.total)}${x.form ? `. Official figure: form ${x.form}` : ""}.`,
        x.note,
        ...ledger("Transactions", x.lines, accounts).slice(1),
      ]),
      "",
      s.nothing.length ? `Looked for and not found: ${s.nothing.map((n) => n.title).join(", ")}.` : "Something was found for every section.",
      ...(s.political.length ? [`Left out of gifts to charity: ${s.political.length} to campaigns or parties (${money(political)}), which aren't deductible.`] : []),
    ],
  };
}

export function researchFetch(d: AgentData, site: string, id: string): ResearchDoc | null {
  const entry = library(d, site).find((e) => e.id === id);
  if (!entry) return null;
  const accounts = new Map(d.accounts.map((a) => [a.id, a]));
  const meta = { kind: entry.kind, as_of: d.today, time_zone: d.timeZone, demo: d.demo };
  const doc = (title: string, body: string[], span?: { from: ISODate; to: ISODate }): ResearchDoc => ({
    id,
    title,
    url: entry.url,
    text: [...header(d, title, entry.url, span), ...body].join("\n"),
    metadata: { ...meta, ...(span ? { from: span.from, to: span.to } : {}) },
  });

  const rest = id.slice(id.indexOf(":") + 1);
  switch (entry.kind) {
    case "summary": {
      const s = SUMMARIES.find((x) => x.id === id)!;
      return doc(entry.title, ["", JSON.stringify(withoutFrame(s.build(d)), null, 2)]);
    }
    case "month": {
      const b = monthBody(d, rest, accounts);
      return doc(entry.title, b.text, b.span);
    }
    case "year": {
      const b = yearBody(d, Number(rest), accounts);
      return doc(entry.title, b.text, b.span);
    }
    case "taxes": {
      const b = taxesBody(d, Number(rest), accounts);
      return doc(entry.title, b.text, b.span);
    }
    case "category": {
      const b = categoryBody(d, rest as SpendCategoryId, accounts);
      return doc(entry.title, b.text, b.span);
    }
    case "merchant": {
      const b = merchantBody(d, rest, accounts);
      return b ? doc(entry.title, b.text, b.span) : null;
    }
  }
}
