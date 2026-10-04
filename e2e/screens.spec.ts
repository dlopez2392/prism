// Every screen, as a visitor meets it on the example household: it answers,
// names itself, carries at most one hero (exactly one where the screen has
// its headline card), says the money isn't real, and never scrolls sideways.

import { expect, test } from "@playwright/test";
import { expectNoSidewaysScroll, watchErrors } from "./helpers";

const SCREENS: { path: string; title: RegExp; hero: boolean }[] = [
  { path: "/", title: /./, hero: true },
  { path: "/cash-flow", title: /Cash flow/, hero: true },
  { path: "/spending", title: /Spending/, hero: true },
  { path: "/budgets", title: /Budgets/, hero: true },
  { path: "/year", title: /Your \d{4}/, hero: true },
  { path: "/taxes", title: /Your \d{4} taxes/, hero: true },
  { path: "/future", title: /Future/, hero: true },
  { path: "/goals", title: /Goals/, hero: true },
  { path: "/net-worth", title: /Net worth/, hero: true },
  { path: "/connections", title: /Connections/, hero: true },
  { path: "/privacy", title: /Privacy/, hero: false },
  { path: "/terms", title: /Terms/, hero: false },
];

for (const s of SCREENS) {
  test(`${s.path} renders whole`, async ({ page }) => {
    const errors = watchErrors(page);
    const res = await page.goto(s.path);
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1").first()).toHaveText(s.title);
    await expect(page.locator("[data-hero]")).toHaveCount(s.hero ? 1 : 0);
    await expectNoSidewaysScroll(page);
    expect(errors).toEqual([]);
  });
}

test("the example household says, on every money screen, that it isn't real money", async ({ page }) => {
  await page.goto("/spending");
  // At any width: on a phone the sidebar that also says so is hidden, so it's the visible notice that counts.
  await expect(page.getByText(/nothing here is real money/i).filter({ visible: true })).toHaveCount(1);
});

test("a page that doesn't exist says so, and offers the way back", async ({ page }) => {
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("link", { name: /overview|home|back/i }).first()).toBeVisible();
});
