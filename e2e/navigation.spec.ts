// Getting around: the sidebar at desktop width, the tab bar and its More
// sheet on a phone (DESIGN.md rule 9), each marking where you are.

import { expect, test } from "@playwright/test";
import { isPhone } from "./helpers";

test("the sidebar takes you anywhere and marks where you are", async ({ page }) => {
  test.skip(isPhone(page), "The sidebar appears at 1024px and up.");
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
  for (const [label, path] of [
    ["Taxes", "/taxes"],
    ["Future", "/future"],
    ["Your year", "/year"],
  ] as const) {
    await nav.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
  }
});

test("on a phone, the tab bar and its More sheet reach every screen, and Esc closes the sheet", async ({ page }) => {
  test.skip(!isPhone(page), "The tab bar is for phones.");
  await page.goto("/");
  const bar = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
  await bar.getByRole("link", { name: "Spending" }).click();
  await expect(page).toHaveURL(/\/spending$/);
  await expect(bar.getByRole("link", { name: "Spending" })).toHaveAttribute("aria-current", "page");

  await bar.getByRole("button", { name: "More" }).click();
  const sheet = page.locator("#more-sheet");
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await bar.getByRole("button", { name: "More" }).click();
  await sheet.getByRole("link", { name: "Taxes" }).click();
  await expect(page).toHaveURL(/\/taxes$/);
  await expect(sheet).toBeHidden();
});

test("the theme toggle switches light and dark, and remembers it on this device", async ({ page }) => {
  await page.goto("/");
  const html = page.locator("html");
  const before = await html.getAttribute("data-theme");
  await page.getByRole("button", { name: /Switch to (light|dark) theme/ }).click();
  const after = await html.getAttribute("data-theme");
  expect(after).not.toBe(before);
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", after!);
});
