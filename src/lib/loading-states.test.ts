// Every screen has a loading state shaped like itself (DESIGN.md rule 5):
// its own loading.tsx, or one from the screen it belongs to (the second
// sign-in step waits in sign-in's). Only the overview uses the root one, so a
// new screen can't quietly fall back to the overview's shape.

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const app = path.resolve(import.meta.dirname, "../app");

function screens(dir: string): string[] {
  const here = existsSync(path.join(dir, "page.tsx")) ? [dir] : [];
  return here.concat(...readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => screens(path.join(dir, e.name))));
}

describe("loading states", () => {
  it("gives every screen a skeleton of its own shape, not the overview's", () => {
    const missing = screens(app)
      .filter((dir) => dir !== app)
      .filter((dir) => {
        for (let d = dir; d !== app; d = path.dirname(d)) if (existsSync(path.join(d, "loading.tsx"))) return false;
        return true;
      })
      .map((dir) => "/" + path.relative(app, dir));
    expect(missing).toEqual([]);
  });
});
