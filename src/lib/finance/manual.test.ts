// What a person owns or owes, added by hand (manual.ts): how it becomes an
// account with a real trend, and what an untrusted stored copy can do.

import { describe, expect, it } from "vitest";
import { addKindFromHash, addLink, cleanManualName, MAX_MANUAL_ITEMS, manualAccount, manualId, validManualItems, withValue, type ManualItem } from "./manual";

const TODAY = "2026-09-29";
const home: ManualItem = {
  id: "our-house",
  kind: "home",
  name: "Our house",
  values: [
    { month: "2026-01", value: 35_000_000 },
    { month: "2026-06", value: 36_500_000 },
  ],
};

describe("an item as an account", () => {
  it("carries each value forward month by month, from the month it was first entered", () => {
    const a = manualAccount(home, TODAY);
    // Jan–May at $350,000, Jun–Sep at $365,000: nine months, aligned to the right like a newly linked bank.
    expect(a.history).toEqual([...Array(5).fill(35_000_000), ...Array(4).fill(36_500_000)]);
    expect(a).toMatchObject({ balance: 36_500_000, kind: "property", institutionId: "manual", source: "manual", mask: null });
  });

  it("counts money owed as a debt", () => {
    const loan: ManualItem = { id: "mom", kind: "debt", name: "Loan from Mom", values: [{ month: "2026-09", value: 500_000 }] };
    expect(manualAccount(loan, TODAY)).toMatchObject({ balance: -500_000, kind: "loan", history: [-500_000] });
  });

  it("keeps only the months on the chart, and the latest value even from a month still ahead", () => {
    const old: ManualItem = { ...home, values: [{ month: "2023-03", value: 1 }] };
    expect(manualAccount(old, TODAY).history).toHaveLength(13);
    const ahead: ManualItem = { ...home, values: [{ month: "2026-12", value: 7 }] };
    expect(manualAccount(ahead, TODAY)).toMatchObject({ balance: 7, history: [7] });
  });
});

describe("updating a value", () => {
  it("replaces this month's and keeps earlier months as they were", () => {
    const once = withValue(home, "2026-09", 37_000_000);
    const twice = withValue(once, "2026-09", 37_200_000);
    expect(twice.values).toEqual([...home.values, { month: "2026-09", value: 37_200_000 }]);
  });

  it("keeps two years", () => {
    // Thirty months, January 2024 to June 2026, one update each.
    const months = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2024, i, 1)).toISOString().slice(0, 7));
    const item = months.reduce<ManualItem>((it, month, i) => withValue(it, month, i + 1), { ...home, values: [{ month: "2020-01", value: 1 }] });
    expect(item.values).toHaveLength(24);
    expect(item.values[0]).toEqual({ month: "2024-07", value: 7 });
    expect(item.values.at(-1)).toEqual({ month: "2026-06", value: 30 });
  });
});

describe("a link to the add form", () => {
  it("names the kind to start with, and opens on nothing else", () => {
    expect(addLink("home")).toBe("/net-worth#add-home");
    for (const k of ["home", "vehicle", "asset", "debt"] as const) expect(addKindFromHash(addLink(k).slice("/net-worth".length))).toBe(k);
    for (const other of ["", "#add", "#add-", "#add-boat", "#add-HOME", "#add-home-x", "#xadd-home", "add-home", "#add-constructor", "#add-toString"]) expect(addKindFromHash(other), other).toBeNull();
  });
});

describe("names and ids", () => {
  it("takes a name as typed, trimmed, without control characters, up to 40 characters", () => {
    expect(cleanManualName("  Our   house \n")).toBe("Our house");
    expect(cleanManualName("a\u0000b")).toBe("ab");
    for (const bad of ["", "   ", "x".repeat(41), 42, null]) expect(cleanManualName(bad)).toBeNull();
  });

  it("gives each item an id of its own", () => {
    expect(manualId("Our House!", [])).toBe("our-house");
    expect(manualId("Our House", ["our-house", "our-house-2"])).toBe("our-house-3");
    expect(manualId("🏠", [])).toBe("item");
  });
});

describe("a stored copy", () => {
  it("keeps each valid item and drops each invalid one alone", () => {
    const stored = [
      home,
      { ...home, id: "our-house" }, // a second with the same id
      { ...home, id: "bad-kind", kind: "yacht" },
      { ...home, id: "neg", values: [{ month: "2026-01", value: -5 }] },
      { ...home, id: "order", values: [{ month: "2026-06", value: 1 }, { month: "2026-01", value: 2 }] },
      { ...home, id: "month", values: [{ month: "2026-13", value: 1 }] },
      { ...home, id: "UPPER", values: home.values },
      { ...home, id: "huge", values: [{ month: "2026-01", value: 10 ** 13 }] },
      { ...home, id: "proto", kind: "toString" },
    ];
    expect(validManualItems(stored)).toEqual([home]);
  });

  it("is nothing when it isn't a list, and never more than the cap", () => {
    for (const junk of [null, "x", { home }]) expect(validManualItems(junk)).toEqual([]);
    const many = Array.from({ length: MAX_MANUAL_ITEMS + 5 }, (_, i) => ({ ...home, id: `item-${i}` }));
    expect(validManualItems(many)).toHaveLength(MAX_MANUAL_ITEMS);
  });
});
