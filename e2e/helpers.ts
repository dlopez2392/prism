// What every e2e spec checks on any page: it rendered without an error in
// the console or the page, and nothing scrolls sideways (DESIGN.md rule 9).

import { expect, type Page } from "@playwright/test";

/** Collects console errors and uncaught page errors from the moment it's called. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

export async function expectNoSidewaysScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
  expect(scroll, "the page scrolls sideways").toBeLessThanOrEqual(width);
}

export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 1024;
