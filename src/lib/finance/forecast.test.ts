import { describe, expect, it } from "vitest";
import { forecastBalance, safeToSpend, type ForecastEvent } from "./forecast";
import { detectRecurring } from "./recurring";
import { monthly } from "./test-helpers";

const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

describe("forecastBalance", () => {
  const streams = detectRecurring(
    [
      ...monthly(months, 1, -195_000, "Rent", "housing"),
      ...monthly(months, 12, [-8_000, -9_000, -12_000, -11_000, -8_500], "Power", "bills"),
    ],
    "2026-09-20",
  );

  it("applies scheduled bills on their dates", () => {
    const f = forecastBalance({ startBalance: 300_000, today: "2026-09-20", horizonDays: 30, streams, drift: { mean: 0, std: 0 } });
    const on = (d: string) => f.points.find((p) => p.date === d)!;
    expect(on("2026-09-30").expected).toBe(300_000);
    expect(on("2026-10-01").expected).toBe(105_000);
    // A variable bill is forecast at the median of its last three amounts.
    expect(f.lowest).toEqual({ date: "2026-10-12", balance: 105_000 - 11_000 });
    expect(f.events.map((e) => e.merchant)).toEqual(["Rent", "Power"]);
  });

  it("widens the band with time and around variable bills", () => {
    const f = forecastBalance({ startBalance: 300_000, today: "2026-09-20", horizonDays: 30, streams, drift: { mean: -1_000, std: 2_000 } });
    const width = (i: number) => f.points[i]!.high - f.points[i]!.low;
    expect(width(0)).toBe(0);
    expect(width(10)).toBeGreaterThan(width(1));
    const beforePower = f.points.find((p) => p.date === "2026-10-11")!;
    const afterPower = f.points.find((p) => p.date === "2026-10-12")!;
    expect(afterPower.high - afterPower.low).toBeGreaterThan(beforePower.high - beforePower.low);
    expect(f.dailyDrift).toBe(-1_000);
  });
});

describe("safeToSpend", () => {
  const ev = (date: string, amount: number, kind: ForecastEvent["kind"] = "bill"): ForecastEvent => ({
    date,
    amount,
    kind,
    merchant: kind,
    variable: false,
  });

  it("counts every bill before the next paycheck, keeping a cushion", () => {
    const s = safeToSpend(
      250_000,
      "2026-09-27",
      [ev("2026-10-01", -195_000), ev("2026-10-02", 298_000, "income"), ev("2026-10-05", -50_000)],
      25_000,
    );
    expect(s).toEqual({ amount: 30_000, until: "2026-10-02", committed: 195_000, cushion: 25_000 });
  });

  it("never goes negative", () => {
    expect(safeToSpend(10_000, "2026-09-27", [ev("2026-09-28", -50_000)]).amount).toBe(0);
  });
});
