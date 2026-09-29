// Every setting the app reads from the environment is pinned OFF for the unit
// suite (vitest.config.mts), so no real value can change what a test asserts.
// Vercel runs these tests inside the production build, with production's
// settings in the environment: an unpinned one once turned accounts on under
// tests that assumed them off, and a release didn't ship.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("the unit suite's environment", () => {
  it("pins every setting the app reads", () => {
    const read = new Set<string>();
    for (const file of sources(path.join(root, "src"))) {
      for (const m of readFileSync(file, "utf8").matchAll(/\benv\??\.([A-Z][A-Z0-9_]+)/g)) read.add(m[1]!);
    }
    read.delete("NODE_ENV"); // the test runner's own
    const config = readFileSync(path.join(root, "vitest.config.mts"), "utf8");
    const pinned = new Set([...config.matchAll(/^\s+([A-Z][A-Z0-9_]+): "",$/gm)].map((m) => m[1]!));
    expect(read.size).toBeGreaterThan(10);
    expect([...read].filter((name) => !pinned.has(name)).sort()).toEqual([]);
  });

  it("holds under production's own settings, as Vercel's build runs it", () => {
    for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "PLAID_SECRET", "PRISM_VAULT_KEY"]) expect(process.env[name]).toBe("");
  });

  it("pins every replacement vault key too, which the app reads by pattern, not by name", () => {
    expect(Object.entries(process.env).filter(([name, value]) => /^PRISM_VAULT_KEY/.test(name) && value !== "")).toEqual([]);
  });
});
