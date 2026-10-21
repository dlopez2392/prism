// Refunds, saved to the account (sealed in profiles.sealed_txn_details) and
// read back after a reload: a return found come back on its own, one still
// out, a charge twice asked back and undone, one said to have come back
// another way and taken back, and one stopped and put back with Undo.

import type { Page } from "@playwright/test";
import { watchErrors } from "../helpers";
import { daysAgo, expect, household, importRows, test } from "./fixtures";

const card = (page: Page, title: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const row = (page: Page, title: string, name: string) => card(page, title).getByRole("listitem").filter({ hasText: name });

/** Opens the newest purchase at `shop` (money out, never its refund) and says a refund is coming for it: the whole amount, or `amount`. */
async function waitOn(page: Page, shop: string, amount?: string) {
  await page.getByRole("button", { name: new RegExp(`^Open ${shop}, -`) }).first().click();
  const dialog = page.getByRole("dialog");
  if (amount) await dialog.getByLabel("Refund amount").fill(amount);
  await dialog.getByRole("button", { name: "Waiting on a refund" }).click();
  await expect(dialog).toBeHidden();
}

test("refunds a person waits on are found when they come back, and what they say is kept", async ({ page, account }) => {
  void account;
  const errors = watchErrors(page);
  await importRows(page, [
    ...household(),
    { date: daysAgo(20), merchant: "Best Buy", category: "Electronics", amount: -199.99 },
    { date: daysAgo(6), merchant: "Best Buy", category: "Electronics", amount: 199.99 },
    { date: daysAgo(3), merchant: "Target", category: "Shopping", amount: -64.99 },
    { date: daysAgo(9), merchant: "Corner Cafe", category: "Restaurants", amount: -25 },
    { date: daysAgo(9), merchant: "Corner Cafe", category: "Restaurants", amount: -25 },
  ]);

  await page.goto("/spending");
  await waitOn(page, "Best Buy");
  await waitOn(page, "Target", "30");

  await page.goto("/refunds");
  await expect(page.locator("h1")).toHaveText("Refunds");
  // The Best Buy return already came back: the line of money in from the same shop.
  await expect(row(page, "Came back", "Best Buy").getByText(/· came back/)).toBeVisible();
  await expect(row(page, "Waiting on", "Target").getByText("$30.00")).toBeVisible();
  await expect(page.locator("[data-hero]").getByText("$30", { exact: true })).toBeVisible();

  // A charge twice, asked back: it moves to waiting, and Undo puts it back.
  await row(page, "You might be owed", "Corner Cafe").getByRole("button", { name: /^I asked for/ }).click();
  await expect(row(page, "Waiting on", "Corner Cafe")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row(page, "You might be owed", "Corner Cafe")).toHaveCount(1);
  await expect(row(page, "Waiting on", "Corner Cafe")).toHaveCount(0);

  // Came back another way, then not after all.
  await row(page, "Waiting on", "Target").getByRole("button", { name: /came back$/ }).click();
  await expect(row(page, "Came back", "Target").getByText(/you said it came back/)).toBeVisible();
  await page.reload();
  await expect(row(page, "Came back", "Target")).toHaveCount(1);
  await row(page, "Came back", "Target").getByRole("button", { name: /hasn't come back$/ }).click();
  await expect(row(page, "Waiting on", "Target")).toHaveCount(1);

  // Stopped, and put back with Undo; still there after a reload.
  await row(page, "Waiting on", "Target").getByRole("button", { name: /^Stop waiting/ }).click();
  await expect(row(page, "Waiting on", "Target")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row(page, "Waiting on", "Target")).toHaveCount(1);
  await page.reload();
  await expect(row(page, "Waiting on", "Target").getByText("$30.00")).toBeVisible();
  expect(errors).toEqual([]);
});
