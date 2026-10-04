// "Download your data" (src/app/account/export/*), as a browser meets it:
// signed out goes to sign-in, the demo household is never handed over as
// someone's own, the person's OWN money only (never the household view), and
// every file is an attachment no cache keeps.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDemoData } from "@/lib/finance/demo";
import { parseCsv } from "@/lib/finance/import";
import { unzip } from "./test-unzip";

vi.mock("server-only", () => ({}));
const signedIn = { current: null as null | { userId: string; email: string } };
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => signedIn.current }));

const TODAY = "2026-10-01";
const own = { current: { ...buildDemoData(TODAY), source: "plaid" } as Record<string, unknown> };
const getPersonalFinance = vi.fn(async () => own.current);
const getFinance = vi.fn(async () => {
  throw new Error("An export must never follow the household switch.");
});
vi.mock("@/lib/server/finance", () => ({ getPersonalFinance: () => getPersonalFinance(), getFinance: () => getFinance() }));

const { GET: transactions } = await import("@/app/account/export/transactions.csv/route");
const { GET: everything } = await import("@/app/account/export/everything.zip/route");
const { GET: taxes } = await import("@/app/account/export/taxes.csv/route");

const SITE = "https://prism.bis-rgv.com";
const get = (route: (req: Request) => Promise<Response>, path: string) => route(new Request(`${SITE}${path}`));

function setOwn(over: Record<string, unknown> = {}) {
  own.current = {
    ...buildDemoData(TODAY),
    source: "plaid",
    account: { email: "sam@example.com", firstName: "Sam", calendarFeed: false, alerts: null },
    wallets: [{ id: "w1", chain: "bitcoin", address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", name: "Cold storage", reading: null }],
    manual: [],
    homeValues: [],
    ...over,
  };
}

describe("downloading your data", () => {
  beforeEach(() => {
    signedIn.current = { userId: "u1", email: "sam@example.com" };
    setOwn();
    getPersonalFinance.mockClear();
  });

  it("sends someone signed out to sign in first, reading nothing", async () => {
    signedIn.current = null;
    for (const route of [transactions, everything, taxes]) {
      const res = await get(route, "/account/export/x");
      expect(res.status).toBe(303);
      expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe("/sign-in?next=/account");
    }
    expect(getPersonalFinance).not.toHaveBeenCalled();
  });

  it("never hands over the demo household as someone's own", async () => {
    setOwn({ source: "demo" });
    for (const route of [transactions, everything, taxes]) {
      const res = await get(route, "/account/export/x");
      expect(res.status).toBe(404);
      expect(await res.text()).toMatch(/Nothing of yours to download yet/);
    }
  });

  it("sends every transaction as a spreadsheet to save, never to cache", async () => {
    const res = await get(transactions, "/account/export/transactions.csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="prism-transactions-${TODAY}.csv"`);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const rows = parseCsv(await res.text(), 100_000);
    expect(rows.length - 1).toBe((own.current.transactions as unknown[]).length);
  });

  it("keeps one year when asked, and ignores a year that isn't one", async () => {
    const year = await get(transactions, "/account/export/transactions.csv?year=2025");
    expect(year.headers.get("content-disposition")).toContain("prism-transactions-2025.csv");
    expect(parseCsv(await year.text(), 100_000).slice(1).every((r) => r[0]!.startsWith("2025-"))).toBe(true);
    const junk = await get(transactions, "/account/export/transactions.csv?year=../../etc");
    expect(junk.headers.get("content-disposition")).toContain(`prism-transactions-${TODAY}.csv`);
  });

  it("sends everything as one zip: the spreadsheets, a JSON file and a README, and nothing that opens anything", async () => {
    const res = await get(everything, "/account/export/everything.zip");
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="prism-export-${TODAY}.zip"`);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const files = unzip(Buffer.from(await res.arrayBuffer()));
    expect([...files.keys()].sort()).toEqual(["README.txt", "accounts.csv", "balances.csv", "budgets.csv", "everything.json", "goals.csv", "holdings.csv", "transactions.csv"]);
    const json = JSON.parse(files.get("everything.json")!);
    expect(json.you).toEqual({ email: "sam@example.com", first_name: "Sam" });
    expect(json.wallets).toEqual([{ name: "Cold storage", chain: "bitcoin", public_address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4" }]);
    expect(files.get("everything.json")!).not.toMatch(/"(token|sealed|secret|password)/i);
  });

  it("sends a year's taxes for whoever does the return: the year asked for, else the one a person most likely means", async () => {
    const res = await get(taxes, "/account/export/taxes.csv?year=2025");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="prism-taxes-2025.csv"`);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const rows = parseCsv(await res.text(), 100_000);
    expect(rows[0]).toEqual(["Section", "Date", "Merchant", "Paid to or from", "Amount", "Account", "Form"]);
    expect(rows.slice(1).every((r) => r[1] === "" || r[1]!.startsWith("2025-"))).toBe(true);
    expect(rows.some((r) => r[0] === "Interest")).toBe(true);
    // October: the April deadline has passed, so this year.
    const junk = await get(taxes, "/account/export/taxes.csv?year=../../etc");
    expect(junk.headers.get("content-disposition")).toContain("prism-taxes-2026.csv");
  });

  it("reads only the person's own money, never the household view", async () => {
    await get(everything, "/account/export/everything.zip");
    await get(transactions, "/account/export/transactions.csv");
    await get(taxes, "/account/export/taxes.csv");
    expect(getPersonalFinance).toHaveBeenCalledTimes(3);
    expect(getFinance).not.toHaveBeenCalled();
  });
});
