// Home values from RentCast (home-values.ts, manual-actions.ts): asked only
// with the database's go-ahead, sent only the address, kept sealed apart from
// the items, and never over a value the person typed.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeValuation } from "@/lib/finance/home-value";
import type { ManualItem } from "@/lib/finance/manual";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/i18n/server", async () => ({ getT: async () => (await import("@/lib/i18n/t")).EN }));
vi.mock("./finance", () => ({ requestToday: async () => "2026-09-29" }));
const signedIn = { current: null as unknown };
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => signedIn.current }));

const { deleteManualItem, saveManualItem } = await import("./manual-actions");
const { refreshDueHomeValues } = await import("./home-values");
const { openPacked, sealPacked, vaultKey } = await import("./vault");

const KEY = randomBytes(32);
const IDLE = { status: "idle" as const };
const ADDRESS = "12 Maple Ct, Austin, TX 78701";
const HOME_KEY = "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
const ESTIMATE = { price: 412_000, priceRangeLow: 390_000, priceRangeHigh: 431_000, comparables: [{ formattedAddress: "somewhere else" }] };

function profileDb(items: ManualItem[] | null, homes: HomeValuation[] = [], answer: string | (() => string) = "ok") {
  const row: Record<string, string | null> = {
    sealed_manual_items: items ? sealPacked(items, KEY) : null,
    sealed_home_values: homes.length ? sealPacked({ v: 1, homes }, KEY) : null,
  };
  const writes: Record<string, unknown>[] = [];
  const claims: { name: string; args: unknown }[] = [];
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...row }, error: null }) }) }),
      upsert: async (values: Record<string, unknown>) => (writes.push(values), Object.assign(row, values), { error: null }),
    }),
    rpc: async (name: string, args: unknown) => (claims.push({ name, args }), { data: typeof answer === "function" ? answer() : answer, error: null }),
  };
  const account = { userId: "u1", email: "a@x.test", supabase: db };
  signedIn.current = account;
  return {
    row,
    writes,
    claims,
    account: account as never,
    items: () => openPacked(row.sealed_manual_items!, KEY) as ManualItem[],
    homes: () => (row.sealed_home_values ? (openPacked(row.sealed_home_values, KEY) as { homes: HomeValuation[] }).homes : []),
  };
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

const rentcast = (status = 200, body: unknown = ESTIMATE) => {
  const f = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", f);
  return f;
};

const house = (values: ManualItem["values"]): ManualItem => ({ id: "our-house", kind: "home", name: "Our house", values });
const valued = (estimate: HomeValuation["estimate"] = null): HomeValuation => ({ itemId: "our-house", address: ADDRESS, key: HOME_KEY, estimate });

beforeEach(() => {
  vi.stubEnv("PRISM_VAULT_KEY", KEY.toString("base64"));
  vi.stubEnv("RENTCAST_API_KEY", "rc-test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  signedIn.current = null;
});

describe("a home RentCast keeps up to date", () => {
  it("left blank, takes RentCast's estimate, asked with the go-ahead and sent the address alone, and keeps the address sealed apart", async () => {
    const db = profileDb(null);
    const f = rentcast();
    const r = await saveManualItem(IDLE, form({ kind: "home", name: "Our house", value: "", estimate: "on", address: `  ${ADDRESS} ` }));
    expect(r).toMatchObject({ status: "saved", message: "Our house added to your net worth. RentCast estimates $412,000 (between $390,000 and $431,000)." });

    // One go-ahead, for this home's own random key; one request, carrying the address and the key and nothing else.
    const [home] = db.homes();
    expect(db.claims).toEqual([{ name: "claim_home_value_lookup", args: { p_home_key: home!.key } }]);
    expect(f).toHaveBeenCalledTimes(1);
    const url = new URL(String(f.mock.calls[0]![0]));
    expect(`${url.origin}${url.pathname}`).toBe("https://api.rentcast.io/v1/avm/value");
    // The address and nothing else about the person; and RentCast is told not to log it.
    expect(Object.fromEntries(url.searchParams)).toEqual({ address: ADDRESS, compCount: "5", suppressLogging: "true" });
    expect(new Headers(f.mock.calls[0]![1]!.headers).get("X-Api-Key")).toBe("rc-test-key");
    expect(String(f.mock.calls[0]![0])).not.toMatch(/Our|u1|a@x/);

    expect(db.items()).toEqual([{ id: "our-house", kind: "home", name: "Our house", values: [{ month: "2026-09", value: 41_200_000, estimated: true }] }]);
    expect(home).toEqual({ itemId: "our-house", address: ADDRESS, key: expect.stringMatching(/^[0-9a-f-]{36}$/), estimate: { low: 39_000_000, high: 43_100_000, on: "2026-09-29" } });
    // Sealed, and in its own column: the items carry no address.
    expect(db.row.sealed_home_values).not.toContain("Maple");
    expect(JSON.stringify(db.items())).not.toContain("Maple");
  });

  it("keeps a value the person typed as theirs for the month, and asks RentCast nothing", async () => {
    const db = profileDb(null);
    const f = rentcast();
    expect(await saveManualItem(IDLE, form({ kind: "home", name: "Our house", value: "350,000", estimate: "on", address: ADDRESS }))).toMatchObject({ status: "saved" });
    expect(db.claims).toEqual([]);
    expect(f).not.toHaveBeenCalled();
    expect(db.items()[0]!.values).toEqual([{ month: "2026-09", value: 35_000_000 }]);
    expect(db.homes()).toEqual([{ itemId: "our-house", address: ADDRESS, key: expect.any(String), estimate: null }]);
  });

  it("asks RentCast nothing when the database says no, and a new home then needs the person's own figure", async () => {
    for (const [answer, words] of [
      ["limit", /used up for now/],
      ["person-limit", /up to three homes a month/],
      ["refused", /Finish signing in/],
    ] as const) {
      const db = profileDb(null, [], answer);
      const f = rentcast();
      const r = await saveManualItem(IDLE, form({ kind: "home", name: "Our house", value: "", estimate: "on", address: ADDRESS }));
      expect(r).toMatchObject({ status: "error", message: expect.stringMatching(words), fields: { value: expect.any(String) } });
      expect(f).not.toHaveBeenCalled();
      expect(db.writes).toEqual([]);
    }
  });

  it("keeps an existing home's last value when RentCast can't place the address, and says so", async () => {
    const db = profileDb([house([{ month: "2026-08", value: 40_000_000, estimated: true }])], [valued()]);
    rentcast(404, { message: "not found" });
    const r = await saveManualItem(IDLE, form({ id: "our-house", kind: "home", name: "Our house", value: "", estimate: "on", address: ADDRESS }));
    expect(r).toMatchObject({ status: "saved", message: expect.stringMatching(/couldn't find that address.*Its last value stays/) });
    expect(db.items()[0]!.values).toEqual([{ month: "2026-08", value: 40_000_000, estimated: true }]);
  });

  it("doesn't ask twice in a month, and a new address is a new home to the limit", async () => {
    const db = profileDb([house([{ month: "2026-09", value: 41_200_000, estimated: true }])], [valued()]);
    const f = rentcast();
    await saveManualItem(IDLE, form({ id: "our-house", kind: "home", name: "Our house", value: "", estimate: "on", address: ADDRESS }));
    expect(db.claims).toEqual([]);
    expect(f).not.toHaveBeenCalled();
    await saveManualItem(IDLE, form({ id: "our-house", kind: "home", name: "Our house", value: "400,000", estimate: "on", address: "90 Oak Ave, Austin, TX 78702" }));
    expect(db.homes()[0]!.key).not.toBe(HOME_KEY);
  });

  it("forgets the address when estimates are turned off, the item stops being a home, or it's removed", async () => {
    const changes: Record<string, string>[] = [
      { id: "our-house", kind: "home", name: "Our house", value: "400,000" },
      { id: "our-house", kind: "asset", name: "Our house", value: "400,000", estimate: "on", address: ADDRESS },
    ];
    for (const change of changes) {
      const db = profileDb([house([{ month: "2026-08", value: 40_000_000 }])], [valued()]);
      expect(await saveManualItem(IDLE, form(change))).toMatchObject({ status: "saved" });
      expect(db.row.sealed_home_values).toBeNull();
    }
    const db = profileDb([house([{ month: "2026-08", value: 40_000_000 }])], [valued()]);
    expect(await deleteManualItem(IDLE, form({ id: "our-house" }))).toMatchObject({ status: "saved" });
    expect(db.row.sealed_home_values).toBeNull();
  });

  it("checks the address, and offers nothing while RentCast isn't switched on", async () => {
    profileDb(null);
    expect(await saveManualItem(IDLE, form({ kind: "home", name: "Our house", value: "", estimate: "on", address: "home" }))).toMatchObject({
      status: "error",
      fields: { address: expect.any(String) },
    });
    vi.stubEnv("RENTCAST_API_KEY", "");
    const db = profileDb(null);
    const f = rentcast();
    const r = await saveManualItem(IDLE, form({ kind: "home", name: "Our house", value: "", estimate: "on", address: ADDRESS }));
    expect(r).toMatchObject({ status: "error", message: "Check the highlighted fields.", fields: { value: expect.any(String) } });
    expect(db.claims).toEqual([]);
    expect(f).not.toHaveBeenCalled();
    // Nor is an address kept while it's off, whatever the form sends: the privacy policy doesn't list it then.
    expect(await saveManualItem(IDLE, form({ kind: "home", name: "Our house", value: "350,000", estimate: "on", address: ADDRESS }))).toMatchObject({ status: "saved" });
    expect(db.row.sealed_home_values).toBeNull();
  });

  it("stores an address only with a home it belongs to", async () => {
    const db = profileDb(null);
    const { saveAccountManualItemsAndHomes } = await import("./account-store");
    const car: ManualItem = { id: "our-house", kind: "vehicle", name: "Our house", values: [{ month: "2026-09", value: 1_000_000 }] };
    await saveAccountManualItemsAndHomes(db.account, [car], [valued(), { ...valued(), itemId: "gone" }], vaultKey()!);
    expect(db.row.sealed_home_values).toBeNull();
    await saveAccountManualItemsAndHomes(db.account, [house([{ month: "2026-09", value: 1_000_000 }])], [valued(), { ...valued(), itemId: "gone" }], vaultKey()!);
    expect(db.homes().map((h) => h.itemId)).toEqual(["our-house"]);
  });
});

describe("the monthly estimate on a visit", () => {
  const key = () => vaultKey()!;

  it("estimates each home due this month, and only those", async () => {
    const other: ManualItem = { id: "cabin", kind: "home", name: "Cabin", values: [{ month: "2026-09", value: 20_000_000 }] };
    const db = profileDb([house([{ month: "2026-08", value: 40_000_000, estimated: true }]), other], [valued(), { itemId: "cabin", address: "3 Lake Rd, Burnet, TX 78611", key: "1f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f", estimate: null }]);
    const f = rentcast();
    expect(await refreshDueHomeValues(db.account, key(), "2026-09-29")).toBe(1);
    // The cabin already has a value this month (the person's own): it's left alone.
    expect(db.claims).toEqual([{ name: "claim_home_value_lookup", args: { p_home_key: HOME_KEY } }]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(db.items().find((i) => i.id === "our-house")!.values.at(-1)).toEqual({ month: "2026-09", value: 41_200_000, estimated: true });
    expect(db.items().find((i) => i.id === "cabin")!.values).toEqual(other.values);
  });

  it("never writes over a value the person typed while RentCast was answering", async () => {
    const db = profileDb([house([{ month: "2026-08", value: 40_000_000 }])], [valued()]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        db.row.sealed_manual_items = sealPacked([house([{ month: "2026-08", value: 40_000_000 }, { month: "2026-09", value: 39_900_000 }])], KEY);
        return new Response(JSON.stringify(ESTIMATE));
      }),
    );
    await refreshDueHomeValues(db.account, key(), "2026-09-29");
    expect(db.items()[0]!.values.at(-1)).toEqual({ month: "2026-09", value: 39_900_000 });
    // The range is still kept, for the editor.
    expect(db.homes()[0]!.estimate).toEqual({ low: 39_000_000, high: 43_100_000, on: "2026-09-29" });
  });

  it("does nothing without the go-ahead, or while it's switched off", async () => {
    const db = profileDb([house([{ month: "2026-08", value: 40_000_000 }])], [valued()], "already");
    const f = rentcast();
    expect(await refreshDueHomeValues(db.account, key(), "2026-09-29")).toBe(0);
    expect(f).not.toHaveBeenCalled();
    vi.stubEnv("RENTCAST_API_KEY", "");
    const off = profileDb([house([{ month: "2026-08", value: 40_000_000 }])], [valued()]);
    expect(await refreshDueHomeValues(off.account, key(), "2026-09-29")).toBe(0);
    expect(off.claims).toEqual([]);
  });
});
