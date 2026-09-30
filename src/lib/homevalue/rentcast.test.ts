import { describe, expect, it, vi } from "vitest";
import { estimateHomeValue, HomeValueError, homeValuesEnabled } from "./rentcast";

const env = { RENTCAST_API_KEY: "rc-key" };
const answer = (status: number, body: unknown) => vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
const reason = (p: Promise<unknown>) => p.then(() => "none", (e: unknown) => (e instanceof HomeValueError ? e.reason : "other"));

describe("RentCast", () => {
  it("is on only when the operator has set a key", () => {
    expect(homeValuesEnabled({})).toBe(false);
    expect(homeValuesEnabled({ RENTCAST_API_KEY: "  " })).toBe(false);
    expect(homeValuesEnabled(env)).toBe(true);
  });

  it("reads the value and its range in cents, and never trusts a range that leaves the value out", async () => {
    expect(await estimateHomeValue("12 Maple Ct, Austin, TX 78701", env, answer(200, { price: 412_000.4, priceRangeLow: 390_000, priceRangeHigh: 431_000 }))).toEqual({
      value: 41_200_040,
      low: 39_000_000,
      high: 43_100_000,
    });
    expect(await estimateHomeValue("12 Maple Ct, Austin, TX 78701", env, answer(200, { price: 412_000, priceRangeLow: 450_000 }))).toEqual({ value: 41_200_000, low: 41_200_000, high: 41_200_000 });
  });

  it("says why there's no estimate: an address it can't place, a refused key, or no answer", async () => {
    const ask = (f: typeof fetch, e: Record<string, string> = env) => reason(estimateHomeValue("12 Maple Ct, Austin, TX 78701", e, f));
    expect(await ask(answer(404, { message: "no match" }))).toBe("not-found");
    expect(await ask(answer(200, { price: 0 }))).toBe("not-found");
    expect(await ask(answer(200, { price: "412000" }))).toBe("not-found");
    expect(await ask(answer(401, {}))).toBe("refused");
    expect(await ask(answer(200, {}), {})).toBe("refused");
    expect(await ask(answer(429, {}))).toBe("unavailable");
    expect(await ask(answer(503, {}))).toBe("unavailable");
    expect(await ask(answer(200, "<html>"))).toBe("unavailable");
    expect(await ask(vi.fn(async () => Promise.reject(new TypeError("fetch failed"))))).toBe("unavailable");
  });
});
