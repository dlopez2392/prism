// Adding what someone owns or owes (manual-actions.ts): only for a signed-in
// account, only what validates, sealed, and never over items it couldn't read.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_MANUAL_ITEMS, type ManualItem } from "@/lib/finance/manual";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("./finance", () => ({ requestToday: async () => "2026-09-29" }));
const signedIn = { current: null as unknown };
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => signedIn.current }));

const { deleteManualItem, saveManualItem } = await import("./manual-actions");
const { openPacked, sealPacked } = await import("./vault");

const KEY = randomBytes(32);
const IDLE = { status: "idle" as const };

function profileDb(items: ManualItem[] | null, { readFails = false } = {}) {
  const row = { sealed_manual_items: items ? sealPacked(items, KEY) : null };
  const writes: Record<string, unknown>[] = [];
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => (readFails ? { data: null, error: { message: "timeout" } } : { data: row, error: null }) }) }),
      upsert: async (values: Record<string, unknown>) => (writes.push(values), Object.assign(row, values), { error: null }),
    }),
  };
  signedIn.current = { userId: "u1", email: "a@x.test", supabase: db };
  return { row, writes, stored: () => openPacked(row.sealed_manual_items, KEY) as ManualItem[] | null };
}
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const house: ManualItem = { id: "our-house", kind: "home", name: "Our house", values: [{ month: "2026-01", value: 35_000_000 }] };

describe("adding what you own or owe", () => {
  beforeEach(() => vi.stubEnv("PRISM_VAULT_KEY", KEY.toString("base64")));
  afterEach(() => {
    vi.unstubAllEnvs();
    signedIn.current = null;
  });

  it("needs a signed-in account", async () => {
    expect(await saveManualItem(IDLE, form({ kind: "home", name: "Our house", value: "350,000" }))).toMatchObject({ status: "error", message: expect.stringMatching(/Sign in/) });
  });

  it("adds it sealed, as this month's value, and says where it went", async () => {
    const { row, stored } = profileDb(null);
    expect(await saveManualItem(IDLE, form({ kind: "debt", name: "  Loan from   Mom ", value: "$5,000" }))).toMatchObject({ status: "saved", message: "Loan from Mom added to your debts." });
    expect(row.sealed_manual_items).not.toContain("Mom");
    expect(stored()).toEqual([{ id: "loan-from-mom", kind: "debt", name: "Loan from Mom", values: [{ month: "2026-09", value: 500_000 }] }]);
  });

  it("updates this month's value without touching earlier months, and replaces it on a second update", async () => {
    const { stored } = profileDb([house]);
    await saveManualItem(IDLE, form({ id: "our-house", kind: "home", name: "Our house", value: "365000" }));
    await saveManualItem(IDLE, form({ id: "our-house", kind: "home", name: "The house", value: "366000" }));
    expect(stored()).toEqual([{ id: "our-house", kind: "home", name: "The house", values: [house.values[0], { month: "2026-09", value: 36_600_000 }] }]);
  });

  it("says exactly which fields need fixing, and writes nothing", async () => {
    const { writes } = profileDb(null);
    const res = await saveManualItem(IDLE, form({ kind: "yacht", name: "", value: "a lot" }));
    expect(res).toMatchObject({ status: "error", fields: { kind: expect.any(String), name: expect.any(String), value: expect.any(String) } });
    expect(await saveManualItem(IDLE, form({ kind: "home", name: "x".repeat(41), value: "1" }))).toMatchObject({ fields: { name: expect.any(String) } });
    expect(await saveManualItem(IDLE, form({ kind: "home", name: "House", value: "-5" }))).toMatchObject({ fields: { value: expect.any(String) } });
    expect(writes).toEqual([]);
  });

  it("stops at the cap, and never edits an item that isn't there", async () => {
    const full = Array.from({ length: MAX_MANUAL_ITEMS }, (_, i) => ({ ...house, id: `item-${i}` }));
    const { writes } = profileDb(full);
    expect(await saveManualItem(IDLE, form({ kind: "home", name: "One more", value: "1" }))).toMatchObject({ status: "error", message: expect.stringMatching(/up to 30/) });
    expect(await saveManualItem(IDLE, form({ id: "ghost", kind: "home", name: "Ghost", value: "1" }))).toMatchObject({ status: "error" });
    expect(writes).toEqual([]);
  });

  it("removes one, and clears the column when nothing is left", async () => {
    const { row } = profileDb([house]);
    expect(await deleteManualItem(IDLE, form({ id: "our-house" }))).toMatchObject({ status: "saved", message: "Our house removed." });
    expect(row.sealed_manual_items).toBeNull();
  });

  it("never writes over items it couldn't read", async () => {
    const { writes } = profileDb(null, { readFails: true });
    expect(await saveManualItem(IDLE, form({ kind: "home", name: "Our house", value: "350000" }))).toMatchObject({ status: "error" });
    expect(await deleteManualItem(IDLE, form({ id: "our-house" }))).toMatchObject({ status: "error" });
    expect(writes).toEqual([]);
  });
});
