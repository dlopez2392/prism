import { describe, expect, it } from "vitest";
import { buildCashFlowSankey, layoutSankey } from "./sankey";
import type { SpendCategoryId } from "./types";

const spend = (over: Partial<Record<SpendCategoryId, number>>) =>
  ({ housing: 0, food: 0, transport: 0, shopping: 0, fun: 0, health: 0, travel: 0, bills: 0, other: 0, ...over }) as Record<
    SpendCategoryId,
    number
  >;

describe("buildCashFlowSankey", () => {
  it("routes the surplus to Saved so both sides balance", () => {
    const g = buildCashFlowSankey([{ name: "Paycheck", amount: 600_000 }], spend({ housing: 200_000, food: 100_000 }));
    expect(g.total).toBe(600_000);
    expect(g.nodes.map((n) => n.id)).toEqual(["src-0", "income", "housing", "food", "saved"]);
    expect(g.links.find((l) => l.target === "saved")!.value).toBe(300_000);
  });

  it("brings a shortfall in from savings instead of an unbalanced picture", () => {
    const g = buildCashFlowSankey([{ name: "Paycheck", amount: 100_000 }], spend({ travel: 150_000 }));
    expect(g.nodes.find((n) => n.id === "from-savings")!.value).toBe(50_000);
    expect(g.nodes.some((n) => n.id === "saved")).toBe(false);
    const left = g.nodes.filter((n) => n.column === 0).reduce((s, n) => s + n.value, 0);
    const right = g.nodes.filter((n) => n.column === 2).reduce((s, n) => s + n.value, 0);
    expect(left).toBe(right);
  });

  it("keeps each category's fixed colour", () => {
    const g = buildCashFlowSankey([{ name: "Paycheck", amount: 100_000 }], spend({ food: 10_000 }));
    expect(g.nodes.find((n) => n.id === "food")!.color).toBe("var(--c-2)");
  });
});

describe("layoutSankey", () => {
  it("stacks nodes inside the box with heights proportional to value", () => {
    const g = buildCashFlowSankey(
      [
        { name: "Paycheck", amount: 500_000 },
        { name: "Side work", amount: 100_000 },
      ],
      spend({ housing: 300_000, food: 100_000 }),
    );
    const { nodes, links } = layoutSankey(g, { width: 600, height: 300, padding: 10 });
    for (const n of nodes) {
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y + n.h).toBeLessThanOrEqual(300.0001);
    }
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId["src-0"]!.h / byId["src-1"]!.h).toBeCloseTo(5);
    expect(byId.income!.x).toBeGreaterThan(byId["src-0"]!.x);
    expect(byId.housing!.x).toBeGreaterThan(byId.income!.x);
    expect(links).toHaveLength(g.links.length);
    expect(links.every((l) => l.path.startsWith("M") && l.path.endsWith("Z"))).toBe(true);
  });
});
