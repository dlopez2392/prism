import { describe, expect, it } from "vitest";
import { barPath, binOf, linear, monotoneSegments, niceTicks, quantileThresholds, spreadLabels, squarify, thinIndices } from "./geometry";

describe("niceTicks", () => {
  it("picks round steps", () => {
    expect(niceTicks(0, 5_213)).toEqual([0, 2_000, 4_000, 6_000]);
    expect(niceTicks(92_000, 133_000)).toEqual([80_000, 100_000, 120_000, 140_000]);
  });

  it("straddles zero for diverging data", () => {
    const t = niceTicks(-1_200, 3_400);
    expect(t).toContain(0);
    expect(t[0]).toBeLessThanOrEqual(-1_200);
    expect(t.at(-1)).toBeGreaterThanOrEqual(3_400);
  });

  it("survives a flat series", () => {
    expect(niceTicks(0, 0)).toEqual([0, 1]);
  });
});

describe("monotoneSegments", () => {
  it("never overshoots a flat-then-falling series", () => {
    const pts: [number, number][] = [
      [0, 100],
      [10, 100],
      [20, 90],
    ];
    const seg = monotoneSegments(pts)[0]!;
    const ys = seg
      .slice(1)
      .split(" ")
      .map((p) => Number(p.split(",")[1]));
    for (const y of ys) expect(y).toBeGreaterThanOrEqual(100 - 1e-9);
  });
});

describe("step curves", () => {
  it("holds each value until the next point", async () => {
    const { linePath, bandPath } = await import("./geometry");
    const pts: [number, number][] = [
      [0, 10],
      [5, 20],
      [10, 5],
    ];
    expect(linePath(pts, 0, 2, "step")).toBe("M0,10 L5,10 L5,20 L10,20 L10,5");
    expect(bandPath(pts, pts, "step").endsWith("L10,5 L10,20 L5,20 L5,10 L0,10 Z")).toBe(true);
  });
});

describe("barPath", () => {
  it("rounds the data end and squares the foot", () => {
    const p = barPath(0, 100, 20, 10);
    expect(p.startsWith("M0,100")).toBe(true);
    expect(p).toContain("Q0,20 4,20");
  });

  it("draws nothing for a zero bar", () => {
    expect(barPath(0, 100, 100, 10)).toBe("");
  });
});

describe("squarify", () => {
  it("tiles the whole box without overlap", () => {
    const box = { x: 0, y: 0, w: 400, h: 200 };
    const rects = squarify([50, 25, 15, 10], box);
    const area = rects.reduce((s, r) => s + r.w * r.h, 0);
    expect(area).toBeCloseTo(400 * 200);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(400 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(200 + 1e-9);
    }
    expect(rects[0]!.w * rects[0]!.h).toBeCloseTo(40_000);
  });
});

describe("helpers", () => {
  it("maps linearly", () => {
    expect(linear([0, 10], [100, 0])(5)).toBe(50);
  });

  it("thins labels by parity, keeping the last", () => {
    expect(thinIndices(13, 7)).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(thinIndices(12, 6).at(-1)).toBe(11);
  });

  it("bins by quantile with zero reserved for empty days", () => {
    const th = quantileThresholds([0, 10, 20, 30, 40, 50], 5);
    expect(binOf(0, th)).toBe(0);
    expect(binOf(10, th)).toBe(1);
    expect(binOf(50, th)).toBe(5);
  });
});

describe("spreadLabels", () => {
  it("leaves labels that don't touch exactly where their points are", () => {
    expect(spreadLabels([40, 120, 300], 14, 14, 320)).toEqual([40, 120, 300]);
  });

  it("pushes two labels on nearly the same value apart, keeping their order", () => {
    // Net worth's "own" at $130K and "net worth" at $129K end 2px apart.
    const [own, net] = spreadLabels([100, 102], 14, 14, 320);
    expect(net! - own!).toBe(14);
    expect(own).toBe(100);
    // Order is by position, not by input: the lower point keeps the lower label.
    const [a, b] = spreadLabels([102, 100], 14, 14, 320);
    expect(a! - b!).toBe(14);
  });

  it("stays inside the chart, moving the crowd up from the bottom edge", () => {
    expect(spreadLabels([318, 319, 320], 14, 14, 320)).toEqual([292, 306, 320]);
    expect(spreadLabels([2], 14, 14, 320)).toEqual([14]);
  });

  it("keeps every label apart even when they can't all fit", () => {
    const ys = spreadLabels([20, 20, 20, 20], 14, 14, 40);
    expect(ys[0]).toBe(14);
    for (let k = 1; k < ys.length; k++) expect(ys[k]! - ys[k - 1]!).toBe(14);
  });
});
