// src/lib/finance/export.ts
//
// A person's own money, as files they can keep: spreadsheets (RFC 4180 CSV,
// with a byte-order mark so Excel reads accents right) and one JSON file with
// everything. Pure: the routes in src/app/account/export hand it what the
// screens show (the person's own view, never the household's) and send what
// it returns.
//
// Two promises hold every file to the person's safety:
//   - Nothing that opens anything: no bank or Coinbase token, no calendar
//     link, no sealed value. What's here is what the screens already show.
//   - Nothing a spreadsheet would run: a text cell that starts like a formula
//     (=, +, -, @, a tab or a return) gets a leading apostrophe, so a merchant
//     called "=HYPERLINK(…)" stays words (OWASP's CSV-injection advice).
//
// transactions.csv reads straight back into Prism's own Import history (its
// header is one the importer knows), so leaving and coming back loses nothing.

import { categoryLabel } from "./categories";
import { INCOME_LABELS } from "./income";
import type { ManualItem } from "./manual";
import { MANUAL_KINDS } from "./manual";
import { P2P_APP_NAMES, p2pLabel } from "./p2p";
import { taxSummary } from "./taxes";
import type { Account, Budget, Cents, FinanceData, Goal, Holding, ISODate, Institution, Transaction } from "./types";
import { lastMonths } from "./dates";

const FORMULA = /^[=+\-@\t\r]/;

/** An amount Prism formatted itself ("-12.34"): written as it is, since money out must stay a negative number. */
export type Amount = { amount: string };
const amount = (cents: Cents): Amount => ({ amount: dollars(cents) });

type Cell = string | number | Amount | null | undefined;

/** One CSV cell: numbers and amounts as they are, text quoted when it must be and never able to run as a formula. */
export function cell(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    if (!/^-?\d+\.\d{2}$/.test(value.amount)) throw new Error("Not an amount.");
    return value.amount;
  }
  const text = FORMULA.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A whole CSV file: a byte-order mark, the header, then one line per row, CRLF between (RFC 4180). */
export function csv(header: string[], rows: Cell[][]): string {
  return `\uFEFF${[header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** Dollars as a plain number a spreadsheet can add up: "-12.34", never "$12.34" or "(12.34)". */
export function dollars(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));

/** "Everyday Checking ••1234", the way the screens name an account. */
function accountName(a: Account | undefined): string {
  if (!a) return "";
  return a.mask ? `${a.name} ••${a.mask}` : a.name;
}

type Money = Pick<FinanceData, "accounts" | "institutions" | "transactions">;

/**
 * Every transaction, newest first. Optionally one calendar year (the year
 * page's "Download this year"). Columns the importer reads: Date, Merchant,
 * Amount (money out negative), Category, Account.
 */
export function transactionsCsv(data: Money, year?: number): string {
  const accounts = byId(data.accounts);
  const institutions = byId(data.institutions);
  const rows = data.transactions
    .filter((t) => year === undefined || t.date.startsWith(`${year}-`))
    .slice()
    .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? 1 : -1))
    .map((t) => {
      const account = accounts.get(t.accountId);
      return [
        t.date,
        t.merchant,
        amount(t.amount),
        categoryLabel(t.category),
        accountName(account),
        account ? (institutions.get(account.institutionId)?.name ?? "") : "",
        t.pending ? "Pending" : "Posted",
        t.bankCategory ? categoryLabel(t.bankCategory) : "",
        t.category === "income" && t.incomeKind ? INCOME_LABELS[t.incomeKind] : "",
        // Venmo, PayPal and Cash App: who it was for, and what they wrote. Last, so Prism's importer reads the file as before.
        t.p2p ? p2pLabel(t.p2p) : "",
        t.p2p?.note ?? "",
        // What the person added: a split's part, their tags, who owes them. Last, so the importer reads the file as before.
        t.split ? `Part ${t.split.part} of ${t.split.parts}` : "",
        (t.tags ?? []).join(", "),
        t.owed ? t.owed.who : "",
        t.owed ? amount(t.owed.amount) : null,
        t.owed?.paid ?? "",
        // What an Amazon charge paid for, from the person's own order history. Last, so the importer reads the file as before.
        t.order ? t.order.items.map((i) => (i.qty > 1 ? `${i.qty} × ${i.name}` : i.name)).join("; ") : "",
      ];
    });
  return csv(
    ["Date", "Merchant", "Amount", "Category", "Account", "Institution", "Status", "Bank's category", "Kind of income", "Paid to or from", "Payment note", "Split", "Tags", "Owed by", "Owed amount", "Paid back on", "Amazon items"],
    rows,
  );
}

/**
 * The tax summary (finance/taxes.ts) for whoever does the return: one row per
 * transaction, grouped by what a return asks about, each group closed by its
 * total. Money out stays negative, as in every file Prism writes.
 */
export function taxesCsv(data: Money & Pick<FinanceData, "today">, year: number): string {
  const accounts = byId(data.accounts);
  const rows: Cell[][] = [];
  for (const s of taxSummary(data, year).sections) {
    for (const t of s.lines) rows.push([s.title, t.date, t.merchant, t.p2p ? p2pLabel(t.p2p) : "", amount(t.amount), accountName(accounts.get(t.accountId)), s.form]);
    rows.push([s.title, "", `Total of ${s.lines.length} ${s.lines.length === 1 ? "transaction" : "transactions"}`, "", amount(s.side === "in" ? s.total : -s.total), "", s.form]);
  }
  return csv(["Section", "Date", "Merchant", "Paid to or from", "Amount", "Account", "Form"], rows);
}

/** Each account as it stands today. */
export function accountsCsv(data: Pick<FinanceData, "accounts" | "institutions">): string {
  const institutions = byId(data.institutions);
  return csv(
    ["Account", "Institution", "Type", "Last 4", "Balance"],
    data.accounts.map((a) => [a.name, institutions.get(a.institutionId)?.name ?? "", a.kind, a.mask, amount(a.balance)]),
  );
}

/** Every account's balance at the end of each month, one row per account and month (the last month is today). */
export function balancesCsv(data: Pick<FinanceData, "accounts" | "today">): string {
  const rows: Cell[][] = [];
  for (const a of data.accounts) {
    const months = lastMonths(data.today, a.history.length);
    a.history.forEach((v, i) => rows.push([months[i]!, accountName(a), amount(v)]));
  }
  return csv(["Month", "Account", "Balance at month end"], rows);
}

export function budgetsCsv(budgets: Budget[]): string {
  return csv(
    ["Category", "Monthly limit"],
    budgets.map((b) => [categoryLabel(b.category), amount(b.limit)]),
  );
}

export function goalsCsv(goals: Goal[]): string {
  return csv(
    ["Goal", "Target", "Saved", "Monthly contribution", "Target date"],
    goals.map((g) => [g.name, amount(g.target), amount(g.saved), amount(g.monthlyContribution), g.targetDate]),
  );
}

export function holdingsCsv(data: Pick<FinanceData, "holdings" | "accounts">): string {
  const accounts = byId(data.accounts);
  return csv(
    ["Symbol", "Name", "Kind", "Value", "Cost basis", "Account"],
    data.holdings.map((h: Holding) => [h.symbol, h.name, h.assetClass, amount(h.value), amount(h.costBasis), accountName(accounts.get(h.accountId))]),
  );
}

/** What the person keeps in Prism beyond what a bank reports: wallets, things added by hand, homes. Their own, never the household's. */
export type Extras = {
  wallets: { name: string; chain: string; address: string }[];
  manual: ManualItem[];
  homes: { address: string; estimate: { low: Cents; high: Cents; on: ISODate } | null }[];
};

export type Profile = { email: string | null; firstName: string | null };

const money = (c: Cents) => Number(dollars(c));

/**
 * Everything, as one JSON document: what each file holds, in one place, for
 * another app or a person's own records. Amounts in dollars; money out and
 * debts negative, as on the screens.
 */
export function everythingJson(data: FinanceData, extras: Extras, profile: Profile, exportedAt: string) {
  const institutions = byId(data.institutions);
  return {
    about:
      "Everything Prism shows you, from your own accounts (never anyone else's in your household). Amounts are US dollars; money out and debts are negative. No password, bank token or link that opens anything is included.",
    exported_at: exportedAt,
    as_of: data.today,
    you: { email: profile.email, first_name: profile.firstName },
    connections: data.institutions.map((i: Institution) => ({ name: i.name, kind: i.source, status: i.health, last_updated: i.lastSyncedAt })),
    accounts: data.accounts.map((a) => {
      const months = lastMonths(data.today, a.history.length);
      return {
        id: a.id,
        name: a.name,
        institution: institutions.get(a.institutionId)?.name ?? null,
        type: a.kind,
        last4: a.mask,
        balance: money(a.balance),
        month_end_balances: a.history.map((v, i) => ({ month: months[i]!, balance: money(v) })),
        ...(a.liability
          ? {
              terms: {
                next_due: a.liability.dueDate,
                minimum_payment: a.liability.minimumPayment === null ? null : money(a.liability.minimumPayment),
                statement_balance: a.liability.statementBalance === null ? null : money(a.liability.statementBalance),
                apr: a.liability.apr,
              },
            }
          : {}),
      };
    }),
    transactions: data.transactions.map((t: Transaction) => ({
      id: t.id,
      date: t.date,
      merchant: t.merchant,
      amount: money(t.amount),
      category: categoryLabel(t.category),
      ...(t.bankCategory ? { banks_category: categoryLabel(t.bankCategory) } : {}),
      ...(t.category === "income" && t.incomeKind ? { kind_of_income: INCOME_LABELS[t.incomeKind] } : {}),
      ...(t.p2p ? { payment: { app: P2P_APP_NAMES[t.p2p.app], who: p2pLabel(t.p2p), note: t.p2p.note } } : {}),
      ...(t.split ? { split: { part: t.split.part, of_parts: t.split.parts, whole_transaction_id: t.split.of, whole_amount: money(t.split.total) } } : {}),
      ...(t.tags ? { tags: t.tags } : {}),
      ...(t.owed ? { owed: { by: t.owed.who, amount: money(t.owed.amount), paid_back_on: t.owed.paid } } : {}),
      ...(t.order ? { amazon_order: { order_number: t.order.order, ordered_on: t.order.date, items: t.order.items.map((i) => ({ name: i.name, quantity: i.qty, amount: money(i.amount) })) } } : {}),
      account_id: t.accountId,
      pending: t.pending,
    })),
    budgets: data.budgets.map((b) => ({ category: categoryLabel(b.category), monthly_limit: money(b.limit) })),
    goals: data.goals.map((g) => ({
      name: g.name,
      target: money(g.target),
      saved: money(g.saved),
      monthly_contribution: money(g.monthlyContribution),
      target_date: g.targetDate,
      ...(g.accountId ? { follows_account_id: g.accountId } : {}),
    })),
    holdings: data.holdings.map((h) => ({ symbol: h.symbol, name: h.name, kind: h.assetClass, value: money(h.value), cost_basis: money(h.costBasis), account_id: h.accountId })),
    added_by_you: extras.manual.map((m) => ({
      name: m.name,
      kind: MANUAL_KINDS[m.kind].label,
      month_values: m.values.map((v) => ({ month: v.month, value: money(MANUAL_KINDS[m.kind].owed ? -v.value : v.value) })),
    })),
    wallets: extras.wallets.map((w) => ({ name: w.name, chain: w.chain, public_address: w.address })),
    homes: extras.homes.map((h) => ({
      address: h.address,
      latest_estimate: h.estimate ? { low: money(h.estimate.low), high: money(h.estimate.high), on: h.estimate.on } : null,
    })),
    credit_score: data.credit ? { score: data.credit.score, from: data.credit.provider } : null,
  };
}

/** What each file in the download is, for the README inside it. */
export const EXPORT_README = (productName: string, today: ISODate) =>
  [
    `Your money in ${productName}, as of ${today}.`,
    "",
    "transactions.csv  Every transaction, newest first. Money out is negative. Opens in any spreadsheet,",
    `                  and ${productName}'s own Import history reads it back.`,
    "accounts.csv      Each account and its balance today. Debts are negative.",
    "balances.csv      Each account's balance at the end of every month we have.",
    "budgets.csv       Your monthly budgets.",
    "goals.csv         Your savings goals.",
    "holdings.csv      What your investment accounts hold, when your bank reports it.",
    "everything.json   All of the above, and the wallets, homes and things you added by hand, in one file.",
    "",
    "What's not here: your bank sign-ins (Prism never has them), the keys that let Prism read your banks,",
    "and anything of anyone else's in your household. Categories are the ones you chose; where you changed",
    "one, the bank's own category is beside it.",
    "",
  ].join("\r\n");
