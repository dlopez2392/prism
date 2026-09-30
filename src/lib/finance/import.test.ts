// History from a CSV file (import.ts): read in the browser, every row checked
// again on the server. Mint and Monarch exports are recognised by their
// headers; any other spreadsheet maps its own columns.

import { describe, expect, it } from "vitest";
import { assembleImports, categoryFrom, detectColumns, mapIsUsable, mapRows, parseAmount, parseCsv, parseDate, summarize, validImportMeta, validImportRow } from "./import";

const TODAY = "2026-09-30";

describe("reading a CSV file", () => {
  it("handles quotes, doubled quotes, commas and line breaks inside quotes, CRLF, a BOM and blank lines", () => {
    const text = '﻿Date,Description,Amount\r\n2024-03-09,"Joe\'s ""Diner"", Austin",-12.50\r\n\r\n2024-03-10,"Two\nlines",5\n';
    expect(parseCsv(text)).toEqual([
      ["Date", "Description", "Amount"],
      ["2024-03-09", 'Joe\'s "Diner", Austin', "-12.50"],
      ["2024-03-10", "Two\nlines", "5"],
    ]);
    expect(parseCsv("a,b\n1,2\n3,4\n5,6", 2)).toHaveLength(2);
    expect(parseCsv("")).toEqual([]);
  });
});

describe("recognising the file", () => {
  it("knows a Mint export, whose amounts are all positive with a debit or credit beside them", () => {
    const { source, map } = detectColumns(["Date", "Description", "Original Description", "Amount", "Transaction Type", "Category", "Account Name", "Labels", "Notes"]);
    expect(source).toBe("mint");
    expect(map).toMatchObject({ date: 0, merchant: 1, amount: 3, type: 4, category: 5, account: 6 });
    const { rows } = mapRows(
      [
        ["3/09/2024", "Whole Foods", "WHOLEFDS AUS 10", "84.12", "debit", "Groceries", "Chase Sapphire", "", ""],
        ["3/15/2024", "Acme Payroll", "ACME CORP PAYROLL", "2,450.00", "credit", "Paycheck", "Chase Checking", "", ""],
      ],
      map,
      TODAY,
    );
    expect(rows).toEqual([
      { date: "2024-03-09", amount: -8_412, merchant: "Whole Foods", category: "food", account: "Chase Sapphire" },
      { date: "2024-03-15", amount: 245_000, merchant: "Acme Payroll", category: "income", account: "Chase Checking" },
    ]);
  });

  it("knows a Monarch export, whose amounts are signed", () => {
    const { source, map } = detectColumns(["Date", "Merchant", "Category", "Account", "Original Statement", "Notes", "Amount", "Tags"]);
    expect(source).toBe("monarch");
    const { rows } = mapRows([["2025-01-04", "Shell", "Gas", "Amex Gold", "SHELL OIL 123", "", "-41.20", ""]], map, TODAY);
    expect(rows).toEqual([{ date: "2025-01-04", amount: -4_120, merchant: "Shell", category: "transport", account: "Amex Gold" }]);
  });

  it("maps a bank's own spreadsheet, with one signed column or money out and in apart", () => {
    const signed = detectColumns(["Posting Date", "Description", "Amount", "Balance"]);
    expect(signed.source).toBe("csv");
    expect(mapIsUsable(signed.map)).toBe(true);
    const split = detectColumns(["Date", "Payee", "Withdrawals", "Deposits"]);
    expect(split.map).toMatchObject({ date: 0, merchant: 1, amount: null, debit: 2, credit: 3 });
    expect(mapRows([["01/02/2025", "Rent", "1,950.00", ""], ["01/03/2025", "Paycheck", "", "2,000"]], split.map, TODAY).rows.map((r) => r.amount)).toEqual([-195_000, 200_000]);
    // A file that writes money out as a positive number says so once.
    expect(mapRows([["2025-01-02", "Rent", "1950"]], { ...signed.map, date: 0, merchant: 1, amount: 2, outIsNegative: false }, TODAY).rows[0]!.amount).toBe(-195_000);
    expect(mapIsUsable(detectColumns(["When", "What"]).map)).toBe(false);
  });

  it("leaves out rows it can't read, and says which line and why", () => {
    const { map } = detectColumns(["Date", "Description", "Amount"]);
    const { rows, skipped } = mapRows(
      [
        ["2024-02-30", "Nope", "-1"],
        ["2027-01-01", "Future", "-1"],
        ["2024-03-01", "", "-1"],
        ["2024-03-01", "Zero", "0"],
        ["2024-03-01", "Words", "twelve"],
        ["2024-03-01", "  Fine   shop ", "-3"],
      ],
      map,
      TODAY,
    );
    expect(rows).toEqual([{ date: "2024-03-01", amount: -300, merchant: "Fine shop", category: "other", account: "Imported account" }]);
    expect(skipped.map((s) => s.line)).toEqual([2, 3, 4, 5, 6]);
    expect(skipped[0]!.reason).toMatch(/date/);
  });
});

describe("dates, amounts and categories", () => {
  it("reads US dates and ISO dates, and no day that doesn't exist", () => {
    expect(parseDate("2024-03-09")).toBe("2024-03-09");
    expect(parseDate("3/9/2024")).toBe("2024-03-09");
    expect(parseDate("03/09/24")).toBe("2024-03-09");
    expect(parseDate("12/31/99")).toBe("1999-12-31");
    expect(parseDate("2024-03-09T10:00:00Z")).toBe("2024-03-09");
    for (const bad of ["2/30/2024", "13/01/2024", "2024/03/09", "March 9", "", "9.3.2024"]) expect(parseDate(bad), bad).toBeNull();
  });

  it("reads amounts in cents, whatever the dollar sign, commas or brackets", () => {
    expect(parseAmount("$1,234.56")).toBe(123_456);
    expect(parseAmount("-12")).toBe(-1_200);
    expect(parseAmount("(45.00)")).toBe(-4_500);
    expect(parseAmount("+0.5")).toBe(50);
    for (const bad of ["", "1.234", "12e3", "abc", "1,2,3.4.5"]) expect(parseAmount(bad), bad).toBeNull();
  });

  it("finds the category from the source's own words, whole words only", () => {
    expect(categoryFrom("Restaurants & Bars", -1)).toBe("food");
    expect(categoryFrom("Hair", -1)).toBe("shopping");
    expect(categoryFrom("Gas & Electric", -1)).toBe("bills");
    expect(categoryFrom("Gas & Fuel", -1)).toBe("transport");
    expect(categoryFrom("Rental Car & Taxi", -1)).toBe("travel");
    expect(categoryFrom("Mortgage & Rent", -1)).toBe("housing");
    expect(categoryFrom("Credit Card Payment", -1)).toBe("transfer");
    expect(categoryFrom("Television", -1)).toBe("fun");
    expect(categoryFrom("Newspapers & Magazines", -1)).toBe("fun");
    // Interest paid is a charge, interest earned is income.
    expect(categoryFrom("Interest", 5)).toBe("income");
    expect(categoryFrom("Finance Charge", -5)).toBe("bills");
    // Nothing Prism knows: the direction of the money decides.
    expect(categoryFrom("Uncategorized", 5)).toBe("income");
    expect(categoryFrom("", -5)).toBe("other");
  });
});

describe("what the server accepts from the browser", () => {
  const row = { date: "2024-03-09", amount: -8_412, merchant: "Whole Foods", category: "food" };
  it("takes a well-formed row and nothing else", () => {
    expect(validImportRow(row, TODAY)).toBe(true);
    for (const bad of [
      null,
      { ...row, extra: 1 },
      { ...row, date: "2024-02-30" },
      { ...row, date: "2027-01-01" },
      { ...row, amount: 0 },
      { ...row, amount: 1.5 },
      { ...row, amount: 1e15 },
      { ...row, merchant: "" },
      { ...row, merchant: " padded " },
      { ...row, merchant: "x".repeat(121) },
      { ...row, merchant: "bell\u0007" },
      { ...row, category: "crypto" },
      { ...row, category: "toString" },
    ]) {
      expect(validImportRow(bad, TODAY), JSON.stringify(bad)).toBe(false);
    }
  });

  it("takes an import's description only when every field checks out", () => {
    const meta = { name: "Chase Checking", kind: "checking", attachTo: null, source: "mint", parts: 3 };
    expect(validImportMeta(meta)).toBe(true);
    expect(validImportMeta({ ...meta, attachTo: "acc-1" })).toBe(true);
    for (const bad of [{ ...meta, kind: "crypto" }, { ...meta, parts: 0 }, { ...meta, parts: 61 }, { ...meta, name: "" }, { ...meta, source: "ynab" }, { ...meta, attachTo: "" }]) {
      expect(validImportMeta(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("putting an import back together", () => {
  const meta = { name: "Old Visa", kind: "credit" as const, attachTo: null, source: "mint" as const, parts: 2 };
  const row = (n: number) => ({ date: `2020-01-${String(n).padStart(2, "0")}`, amount: -n * 100, merchant: `Shop ${n}`, category: "shopping" });
  const NOW = Date.parse("2026-09-30T12:00:00Z");
  const at = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

  it("shows an import only once every part it counts is there, rows in order and checked again", () => {
    const { imports, abandoned } = assembleImports(
      [
        { importId: "a", part: 1, opened: { v: 1, rows: [row(3), { ...row(4), amount: 0 }] }, createdAt: at(2) },
        { importId: "a", part: 0, opened: { v: 1, meta, rows: [row(1), row(2)] }, createdAt: at(1) },
        // Part 0 counts two parts, and only one arrived: not shown, and not abandoned yet.
        { importId: "b", part: 0, opened: { v: 1, meta, rows: [row(5)] }, createdAt: at(1) },
      ],
      NOW,
    );
    expect(imports).toEqual([{ id: "a", meta, rows: [row(1), row(2), row(3)], importedAt: at(1) }]);
    expect(abandoned).toEqual([]);
    expect(summarize(imports[0]!)).toEqual({ id: "a", name: "Old Visa", attachTo: null, rows: 3, from: "2020-01-01", to: "2020-01-03", importedAt: at(1) });
  });

  it("gives up on one left unfinished for over a day, but never on one it merely can't open", () => {
    const { imports, abandoned } = assembleImports(
      [
        { importId: "old", part: 1, opened: { v: 1, rows: [row(1)] }, createdAt: at(30) },
        // Sealed under a key this deployment doesn't have (or has none at all, for a moment): unreadable, not abandoned.
        { importId: "sealed-elsewhere", part: 0, opened: null, createdAt: at(30) },
        { importId: "sealed-elsewhere", part: 1, opened: null, createdAt: at(30) },
        { importId: "fresh", part: 1, opened: { v: 1, rows: [row(1)] }, createdAt: at(2) },
      ],
      NOW,
    );
    expect(imports).toEqual([]);
    expect(abandoned).toEqual(["old"]);
  });
});
