// A person's own money as files (export.ts): cells a spreadsheet can't run,
// amounts it can add up, a transactions file Prism's own importer reads back
// exactly as it went out, and a JSON file that carries nothing that opens
// anything.

import { describe, expect, it } from "vitest";
import { buildDemoData } from "./demo";
import { accountsCsv, balancesCsv, cell, csv, dollars, everythingJson, EXPORT_README, transactionsCsv } from "./export";
import { detectColumns, mapIsUsable, mapRows, parseCsv } from "./import";
import { tx } from "./test-helpers";
import type { FinanceData } from "./types";

const TODAY = "2026-10-01";
const data: FinanceData = buildDemoData(TODAY);

describe("a cell", () => {
  it("is quoted only when it must be, with quotes doubled", () => {
    expect(cell("Corner Coffee")).toBe("Corner Coffee");
    expect(cell("Smith, Jones & Co")).toBe('"Smith, Jones & Co"');
    expect(cell('The "Good" Diner')).toBe('"The ""Good"" Diner"');
    expect(cell("two\nlines")).toBe('"two\nlines"');
    expect(cell(null)).toBe("");
    expect(cell(42)).toBe("42");
  });

  it("never runs as a formula in a spreadsheet", () => {
    for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tTAB", "\rCR"]) expect(cell(evil).replace(/^"/, "").startsWith("'")).toBe(true);
    expect(cell("=1+1")).toBe("'=1+1");
  });

  it("opens with a byte-order mark and ends each line with CRLF", () => {
    expect(csv(["A", "B"], [["1", "2"]])).toBe("\uFEFFA,B\r\n1,2\r\n");
  });
});

describe("dollars", () => {
  it("are plain numbers a spreadsheet adds up", () => {
    expect(dollars(-1234)).toBe("-12.34");
    expect(dollars(5)).toBe("0.05");
    expect(dollars(0)).toBe("0.00");
    expect(dollars(123_456_789)).toBe("1234567.89");
    expect(dollars(-100)).toBe("-1.00");
  });
});

describe("the transactions file", () => {
  it("reads back into Prism's own importer exactly as it went out", () => {
    // A refund Prism couldn't place is Other, money in: it must come back as Other, not as income.
    const withRefund: FinanceData = { ...data, transactions: [...data.transactions, tx("2026-09-10", 1_500, "Mystery refund", "other")] };
    const rows = parseCsv(transactionsCsv(withRefund), 100_000);
    const { map } = detectColumns(rows[0]!);
    expect(mapIsUsable(map)).toBe(true);
    const back = mapRows(rows.slice(1), map, TODAY);
    expect(back.skipped).toEqual([]);
    const key = (t: { date: string; amount: number; merchant: string; category: string }) => `${t.date}|${t.amount}|${t.merchant}|${t.category}`;
    const sent = withRefund.transactions.filter((t) => t.date <= TODAY).map(key).sort();
    expect(back.rows.map(key).sort()).toEqual(sent);
  });

  it("lists newest first, names the account and its bank, and says what's still pending", () => {
    const text = transactionsCsv(data);
    const rows = parseCsv(text, 100_000);
    expect(rows[0]).toEqual(["Date", "Merchant", "Amount", "Category", "Account", "Institution", "Status", "Bank's category", "Kind of income", "Paid to or from", "Payment note"]);
    const dates = rows.slice(1).map((r) => r[0]!);
    expect(dates).toEqual([...dates].sort().reverse());
    const first = data.accounts[0]!;
    expect(text).toContain(first.mask ? `${first.name} ••${first.mask}` : first.name);
    expect(new Set(rows.slice(1).map((r) => r[6]))).toEqual(new Set(data.transactions.some((t) => t.pending) ? ["Posted", "Pending"] : ["Posted"]));
  });

  it("keeps the bank's category beside one the person fixed", () => {
    const fixed: FinanceData = { ...data, transactions: [{ ...tx("2026-09-02", -4_500, "Corner Store", "food"), bankCategory: "shopping" }] };
    const [, row] = parseCsv(transactionsCsv(fixed));
    expect(row!.slice(3, 4)).toEqual(["Food & dining"]);
    expect(row![7]).toBe("Shopping");
  });

  it("says who a Venmo, PayPal or Cash App payment was for, with another person's note written as words", () => {
    const paid: FinanceData = {
      ...data,
      transactions: [{ ...tx("2026-09-13", -4_500, "Venmo", "transfer"), p2p: { app: "venmo", dir: "to", name: "Alex Kim", note: "=SUM(A1:A9)", date: "2026-09-12" } }],
    };
    const [header, row] = parseCsv(transactionsCsv(paid));
    expect(row!.slice(header!.indexOf("Paid to or from"))).toEqual(["To Alex Kim", "'=SUM(A1:A9)"]);
    const [t] = everythingJson(paid, { wallets: [], manual: [], homes: [] }, { email: "a@x.test", firstName: null }, "2026-10-01T00:00:00Z").transactions;
    expect(t).toMatchObject({ payment: { app: "Venmo", who: "To Alex Kim", note: "=SUM(A1:A9)" } });
  });

  it("keeps one year, for the year page", () => {
    const rows = parseCsv(transactionsCsv(data, 2025), 100_000).slice(1);
    expect(rows.length).toBe(data.transactions.filter((t) => t.date.startsWith("2025-")).length);
    expect(rows.every((r) => r[0]!.startsWith("2025-"))).toBe(true);
  });

  it("writes a merchant that looks like a formula as words", () => {
    const evil: FinanceData = { ...data, transactions: [tx("2026-09-02", -100, '=HYPERLINK("http://evil.example","Refund")', "other")] };
    const [, row] = parseCsv(transactionsCsv(evil));
    expect(row![1]!.startsWith("'=")).toBe(true);
  });
});

describe("the account files", () => {
  it("give each account today, and its balance at every month end, the last being this month", () => {
    const accounts = parseCsv(accountsCsv(data), 10_000);
    expect(accounts.length - 1).toBe(data.accounts.length);
    const balances = parseCsv(balancesCsv(data), 100_000).slice(1);
    expect(balances.length).toBe(data.accounts.reduce((s, a) => s + a.history.length, 0));
    const a = data.accounts[0]!;
    const mine = balances.filter((r) => r[1] === (a.mask ? `${a.name} ••${a.mask}` : a.name));
    expect(mine.at(-1)).toEqual(["2026-10", mine.at(-1)![1], dollars(a.balance)]);
  });
});

describe("everything.json", () => {
  const extras = {
    wallets: [{ name: "Cold storage", chain: "bitcoin", address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4" }],
    manual: [{ id: "m1", kind: "debt" as const, name: "Loan from Mom", values: [{ month: "2026-09", value: 50_000 }] }],
    homes: [{ address: "1 Main St, Austin, TX", estimate: { low: 30_000_000, high: 34_000_000, on: "2026-09-01" } }],
  };
  const doc = everythingJson(data, extras, { email: "sam@example.com", firstName: "Sam" }, "2026-10-01T12:00:00.000Z");

  it("holds every account and transaction, in dollars, money out negative", () => {
    expect(doc.accounts).toHaveLength(data.accounts.length);
    expect(doc.transactions).toHaveLength(data.transactions.length);
    const t = data.transactions.find((x) => x.amount < 0)!;
    expect(doc.transactions.find((x) => x.id === t.id)!.amount).toBe(Number(dollars(t.amount)));
    expect(doc.added_by_you[0]!.month_values).toEqual([{ month: "2026-09", value: -500 }]);
    expect(doc.wallets[0]!.public_address).toBe(extras.wallets[0]!.address);
  });

  it("carries nothing that opens anything", () => {
    const text = JSON.stringify(doc).toLowerCase();
    for (const word of ["token", "sealed", "secret", "password", "access_"]) expect(text).not.toContain(`"${word}`);
    expect(JSON.stringify(doc)).not.toMatch(/access-(sandbox|production)/);
  });
});

describe("the README in the download", () => {
  it("explains every file the download holds", () => {
    const readme = EXPORT_README("Prism", TODAY);
    for (const f of ["transactions.csv", "accounts.csv", "balances.csv", "budgets.csv", "goals.csv", "holdings.csv", "everything.json"]) expect(readme).toContain(f);
  });
});
