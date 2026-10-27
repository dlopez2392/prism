// src/lib/server/test-warm.ts — for tests: pay a module graph's cold transform
// once, in a hook with its own time limit, instead of inside the first test.
//
// The finance-*.test.ts files reset modules and import "./finance" in each
// test. Resetting throws away the evaluated modules but not Vite's transform
// cache, so every test after the first evaluates a warm graph in tens of
// milliseconds. The first test, though, also transformed finance.ts's whole
// graph: about two seconds alone, and past the 5-second test limit when the
// full suite loads every core. Warming here moves that cost out of the tests.
//
// The registry is reset after warming, so the first test still gets fresh
// modules, evaluated after its own beforeEach (stubbed env, mocks' state),
// exactly as before. Only the transform cache carries over.

import { beforeAll, vi } from "vitest";

/** Long enough for a cold transform on a loaded machine; a test's own limit is unchanged. */
const WARM_TIMEOUT = 60_000;

/** Pass the test file's own import (`() => import("./finance")`) so it resolves from there. */
export function warmModules(load: () => Promise<unknown>): void {
  beforeAll(async () => {
    await load();
    vi.resetModules();
  }, WARM_TIMEOUT);
}
