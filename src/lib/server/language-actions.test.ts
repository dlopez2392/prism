// The EN | ES toggle's action (language-actions.ts): only a language Prism has
// is kept, in a cookie the browser's scripts can't read, for a year.

import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, { value: string; options: Record<string, unknown> }>();
vi.mock("next/headers", () => ({ cookies: async () => ({ set: (name: string, value: string, options: Record<string, unknown>) => jar.set(name, { value, options }) }) }));

const { chooseLanguage } = await import("./language-actions");

describe("choosing a language", () => {
  beforeEach(() => jar.clear());

  it("keeps Spanish or English for a year, out of the page's scripts", async () => {
    await chooseLanguage("es");
    expect(jar.get("prism-lang")).toEqual({ value: "es", options: expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 31_536_000 }) });
    await chooseLanguage("en");
    expect(jar.get("prism-lang")?.value).toBe("en");
  });

  it("ignores anything else", async () => {
    for (const asked of ["fr", "ES", "", null, { locale: "es" }, "es; Domain=evil.test"]) await chooseLanguage(asked);
    expect(jar.size).toBe(0);
  });
});
