// The page colours brand.ts gives the browser and the installed app are the tokens' own.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAGE_COLORS } from "./brand";

describe("the page colours outside the page", () => {
  it("match --surface-0 in each theme", () => {
    const tokens = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
    const values = [...tokens.matchAll(/--surface-0:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]!.toLowerCase());
    expect(values[0]).toBe(PAGE_COLORS.light);
    expect(values.slice(1)).toEqual(expect.arrayContaining([PAGE_COLORS.dark]));
    expect(new Set(values.slice(1))).toEqual(new Set([PAGE_COLORS.dark]));
  });
});
