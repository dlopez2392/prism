import { describe, expect, it } from "vitest";
import { tx } from "./test-helpers";
import { dailyBalances, LEDGER_FIND_MAX, ledgerHash, monthWindow, parseRange, readLedgerHash } from "./view";

describe("monthWindow", () => {
  it("counts the current month and mirrors the span before it", () => {
    expect(monthWindow("2026-09-27", 3)).toMatchObject({
      from: "2026-07-01",
      to: "2026-09-27",
      prevTo: "2026-06-30",
      months: ["2026-07", "2026-08", "2026-09"],
    });
  });
});

describe("parseRange", () => {
  it("accepts only the offered ranges", () => {
    expect(parseRange("12")).toBe(12);
    expect(parseRange("7")).toBe(6);
    expect(parseRange(undefined, 3)).toBe(3);
  });
});

describe("dailyBalances", () => {
  it("walks backwards from today's balance", () => {
    const out = dailyBalances(
      [tx("2026-09-02", -500, "a", "food", "chk"), tx("2026-09-03", 1_000, "pay", "income", "chk"), tx("2026-09-03", -99, "x", "food", "card")],
      "chk",
      10_000,
      "2026-09-01",
      "2026-09-03",
    );
    expect(out).toEqual([
      { date: "2026-09-01", balance: 9_500 },
      { date: "2026-09-02", balance: 9_000 },
      { date: "2026-09-03", balance: 10_000 },
    ]);
  });
});

describe("ledger links", () => {
  it("carry a category or a merchant in the fragment, and read back as they were written", () => {
    expect(ledgerHash({ category: "food" })).toBe("#category=food");
    expect(ledgerHash({ find: "green basket & co" })).toBe("#find=green+basket+%26+co");
    expect(readLedgerHash(ledgerHash({ find: "green basket & co" }))).toEqual({ find: "green basket & co" });
    expect(readLedgerHash(ledgerHash({ category: "transfer" }))).toEqual({ category: "transfer" });
  });

  it("ignore a fragment that asks for nothing a ledger knows", () => {
    for (const hash of ["", "#", "#transactions", "#category=snacks", "#category=__proto__", "#category=toString", "#find=", "#find=%20%20"]) expect(readLedgerHash(hash)).toBeNull();
  });

  it("never ask for more than the search box takes", () => {
    expect(readLedgerHash(`#find=${"a".repeat(500)}`)).toEqual({ find: "a".repeat(LEDGER_FIND_MAX) });
    expect(ledgerHash({ find: "b".repeat(500) })).toBe(`#find=${"b".repeat(LEDGER_FIND_MAX)}`);
  });
});
