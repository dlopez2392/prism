// What a visit leaves for the email job (alert-snapshot.ts): the alerts it
// found except a bank's (the database has those fresher), the week's figures
// as the screens count them, the next two weeks' bills, and nothing that
// doesn't read as one when it's opened again.

import { describe, expect, it } from "vitest";
import { alertSnapshot, validSnapshot } from "./alert-snapshot";
import { sumSpending } from "./cashflow";
import { analyze } from "./model";
import { monthly, tx } from "./test-helpers";
import type { Account, FinanceData, Institution, Transaction } from "./types";

const TODAY = "2026-09-25";
const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const PAYDAYS = ["2026-04-17", "2026-05-01", "2026-05-15", "2026-05-29", "2026-06-12", "2026-06-26", "2026-07-10", "2026-07-24", "2026-08-07", "2026-08-21", "2026-09-04", "2026-09-18"];
const checking: Account = { id: "chk", institutionId: "bank1", name: "Everyday Checking", mask: "1234", kind: "checking", balance: 50_000, history: [50_000], source: "plaid" };
const bank: Institution = { id: "bank1", name: "First Bank", health: "needs_attention", signInAgain: true, lastSyncedAt: "2026-09-25T12:00:00Z", source: "plaid" };

function data(txns: Transaction[]): FinanceData {
  return {
    source: "plaid",
    today: TODAY,
    household: { name: "Test", firstName: "Sam" },
    institutions: [bank],
    accounts: [checking],
    transactions: txns.sort((a, b) => (a.date < b.date ? -1 : 1)),
    budgets: [{ category: "food", limit: 60_000 }],
    goals: [],
    holdings: [],
    credit: null,
  };
}

const txns = () => [
  ...PAYDAYS.map((d) => tx(d, 200_000, "Acme Payroll", "income")),
  ...monthly(MONTHS, 1, -180_000, "Oak Street Rent", "housing"),
  tx("2026-09-20", -4_200, "Corner Grocer", "food"),
  tx("2026-09-12", -2_500, "Corner Grocer", "food"),
];
const AT = "2026-09-25T15:00:00.000Z";

describe("a visit's alert snapshot", () => {
  const a = analyze(data(txns()));
  const snap = alertSnapshot(a, AT);

  it("keeps the alerts the visit found, but never a bank's", () => {
    expect(snap.alerts.map((x) => x.kind)).toEqual(["bill-short"]);
    expect(snap.alerts[0]!.id).toBe("bill-short:oak street rent:2026-10-01");
  });

  it("counts the week the way the screens do", () => {
    expect(snap.weekly).toMatchObject({
      from: "2026-09-18",
      to: "2026-09-24",
      spent: sumSpending(a.data.transactions, "2026-09-18", "2026-09-24"),
      spentBefore: sumSpending(a.data.transactions, "2026-09-11", "2026-09-17"),
      month: { spent: a.budgetTotals.spent, limit: 60_000 },
    });
    expect(snap.weekly.spent).toBe(4_200);
    expect(snap.weekly.spentBefore).toBe(2_500);
  });

  it("lists the next two weeks' bills as money going out", () => {
    expect(snap.upcoming).toContainEqual({ name: "Oak Street Rent", date: "2026-10-01", amount: 180_000 });
    for (const u of snap.upcoming!) expect(u.date <= "2026-10-09" && u.amount > 0).toBe(true);
  });

  it("opens again as itself, through JSON, as the job will read it", () => {
    expect(validSnapshot(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
  });

  it("opens as nothing when it doesn't read as a snapshot", () => {
    const bad = (over: Record<string, unknown>) => validSnapshot({ ...JSON.parse(JSON.stringify(snap)), ...over });
    expect(validSnapshot(null)).toBeNull();
    expect(validSnapshot("snapshot")).toBeNull();
    expect(bad({ v: 2 })).toBeNull();
    expect(bad({ today: "Sep 25" })).toBeNull();
    expect(bad({ at: "yesterday" })).toBeNull();
    expect(bad({ weekly: { ...snap.weekly, spent: 1.5 } })).toBeNull();
    expect(bad({ alerts: [{ ...snap.alerts[0], kind: "free-money" }] })).toBeNull();
    expect(bad({ alerts: [{ ...snap.alerts[0], title: "x".repeat(301) }] })).toBeNull();
    expect(bad({ alerts: Array.from({ length: 21 }, () => snap.alerts[0]) })).toBeNull();
    expect(bad({ upcoming: "soon" })).toBeNull();
    // A forecast with nothing to say is kept apart from no forecast at all.
    expect(bad({ upcoming: null })!.upcoming).toBeNull();
    expect(bad({ upcoming: [] })!.upcoming).toEqual([]);
  });

  it("counts last whole month the way the screens do, with the month before and the next 30 days' bills", () => {
    expect(snap.monthly).toMatchObject({
      month: "2026-08",
      // Paid Aug 7 and Aug 21; rent on Aug 1.
      income: 400_000,
      spent: 180_000,
      before: { income: 400_000, spent: 180_000 },
      top: [{ label: "Housing", spent: 180_000 }],
      // One month-end balance isn't a month's move.
      netWorth: null,
    });
    const due = a.forecast!.events.filter((e) => e.amount < 0 && e.date <= "2026-10-25");
    expect(snap.monthly!.ahead).toEqual({ count: due.length, total: due.reduce((t, e) => t - e.amount, 0) });
    expect(snap.monthly!.ahead!.count).toBeGreaterThan(0);
    // Thirty days, not thirty-one: a gym due on Oct 26 is left for next time.
    const gym = analyze(data([...txns(), ...monthly(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"], 26, -5_000, "FitClub", "health")]));
    expect(gym.forecast!.events.some((e) => e.merchant === "FitClub" && e.date === "2026-10-26")).toBe(true);
    const ahead = alertSnapshot(gym, AT).monthly!.ahead!;
    const due30 = gym.forecast!.events.filter((e) => e.amount < 0 && e.date <= "2026-10-25");
    expect(ahead).toEqual({ count: due30.length, total: due30.reduce((t, e) => t - e.amount, 0) });
  });

  it("has no month it didn't hold whole, and no month before it unless that's whole too", () => {
    const from = (day: string) => alertSnapshot(analyze(data(txns().filter((t) => t.date >= day))), AT).monthly;
    expect(from("2026-08-02")).toBeNull();
    expect(from("2026-08-01")).toMatchObject({ month: "2026-08", before: null });
    expect(from("2026-07-01")).toMatchObject({ before: { income: 400_000, spent: 180_000 } });
    // The three biggest categories, the most first, and none it didn't spend in.
    const many = [...txns(), tx("2026-08-05", -9_000, "Fuel Stop", "transport"), tx("2026-08-06", -12_000, "Corner Grocer", "food"), tx("2026-08-07", -3_000, "Cinema 8", "fun"), tx("2026-08-08", -1_000, "Wellcare", "health")];
    expect(alertSnapshot(analyze(data(many)), AT).monthly!.top.map((t) => t.label)).toEqual(["Housing", "Food & dining", "Transport"]);
  });

  it("carries net worth's move over the month once there are two month-ends", () => {
    const withHistory = (history: number[]) => alertSnapshot(analyze({ ...data(txns()), accounts: [{ ...checking, history }] }), AT).monthly!.netWorth;
    // The end of August against the end of July: not today's balance.
    expect(withHistory([40_000, 46_000, 50_000])).toEqual({ end: 46_000, change: 6_000 });
    expect(withHistory([46_000, 50_000])).toBeNull();
  });

  it("opens a snapshot from before the recap with no month, and refuses a month that doesn't read whole", () => {
    const stored = JSON.parse(JSON.stringify(snap));
    delete stored.monthly;
    expect(validSnapshot(stored)!.monthly).toBeNull();
    const bad = (over: Record<string, unknown>) => validSnapshot({ ...JSON.parse(JSON.stringify(snap)), monthly: { ...snap.monthly, ...over } });
    expect(bad({ month: "August" })).toBeNull();
    expect(bad({ spent: 1.5 })).toBeNull();
    expect(bad({ before: { income: 1 } })).toBeNull();
    expect(bad({ top: [{ label: "x".repeat(41), spent: 1 }] })).toBeNull();
    expect(bad({ top: Array.from({ length: 4 }, () => ({ label: "Food", spent: 1 })) })).toBeNull();
    expect(bad({ netWorth: { end: 1 } })).toBeNull();
    expect(bad({ ahead: { count: -1, total: 0 } })).toBeNull();
    expect(bad({ ahead: null })!.monthly!.ahead).toBeNull();
  });

  it("has no forecast to list bills from without a checking account", () => {
    const none = alertSnapshot(analyze({ ...data(txns()), accounts: [] }), AT);
    expect(none.upcoming).toBeNull();
    expect(none.alerts).toEqual([]);
  });
});
