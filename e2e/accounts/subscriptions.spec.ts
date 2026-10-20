// Subscriptions, saved to the account (sealed in profiles.sealed_txn_details)
// and read back after a reload: a charge said not to be one and put back with
// Undo, a bill said to be one, one cancelled and un-cancelled, and one Prism
// can't see added, removed and put back with Undo.

import type { Page } from "@playwright/test";
import { watchErrors } from "../helpers";
import { daysAgo, expect, importRows, test } from "./fixtures";

const card = (page: Page, title: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const row = (page: Page, title: string, name: string) => card(page, title).getByRole("listitem").filter({ hasText: name });
/** The hero's monthly total, in whole dollars. */
async function monthly(page: Page): Promise<number> {
  const amount = await page.locator("[data-hero]").getByText(/^\$[\d,]+$/).first().innerText();
  return Number(amount.replace(/[$,]/g, ""));
}

test("a person's subscriptions follow what they say, and keep it", async ({ page, account }) => {
  void account;
  const errors = watchErrors(page);
  await importRows(page);
  await page.goto("/subscriptions");
  await expect(page.locator("h1")).toHaveText("Subscriptions");
  await expect(row(page, "Your subscriptions", "Streamflix")).toHaveCount(1);
  expect(await monthly(page)).toBe(15);

  // Not a subscription: off the list, under the other repeating charges, and back with Undo.
  await row(page, "Your subscriptions", "Streamflix").getByRole("button", { name: "Not a subscription" }).click();
  await expect(page.getByText("Streamflix is off your subscriptions. It's under other repeating charges.")).toBeVisible();
  await expect(row(page, "Other repeating charges", "Streamflix")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row(page, "Your subscriptions", "Streamflix")).toHaveCount(1);

  // The rent said to be one: kept, and read back after a reload.
  await row(page, "Other repeating charges", "Maple Street Rentals").getByRole("button", { name: "It's a subscription" }).click();
  await expect(row(page, "Your subscriptions", "Maple Street Rentals")).toHaveCount(1);
  await page.reload();
  await expect(row(page, "Your subscriptions", "Maple Street Rentals").getByText("Marked by you")).toBeVisible();
  expect(await monthly(page)).toBe(1_465);

  // Cancelled: it moves to the cancelled list, with nothing charged since, and comes back.
  await row(page, "Your subscriptions", "Streamflix").getByRole("button", { name: "I cancelled it" }).click();
  await expect(row(page, "Cancelled", "Streamflix").getByText("No charge since")).toBeVisible();
  await page.reload();
  await expect(row(page, "Cancelled", "Streamflix")).toHaveCount(1);
  await expect(row(page, "Your subscriptions", "Streamflix")).toHaveCount(0);
  await row(page, "Cancelled", "Streamflix").getByRole("button", { name: "It isn't cancelled" }).click();
  await expect(row(page, "Your subscriptions", "Streamflix")).toHaveCount(1);

  // One Prism can't see, added by hand: counted, removed, and put back with Undo.
  await page.getByRole("button", { name: "Add one" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Piano lessons");
  await dialog.getByLabel("What it costs each time").fill("120");
  await dialog.getByLabel("Its next charge").fill(daysAgo(-10));
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, "Your subscriptions", "Piano lessons").getByText("Added by you")).toBeVisible();
  await page.reload();
  await expect(row(page, "Your subscriptions", "Piano lessons")).toHaveCount(1);
  await row(page, "Your subscriptions", "Piano lessons").getByRole("button", { name: "Remove" }).click();
  await expect(row(page, "Your subscriptions", "Piano lessons")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row(page, "Your subscriptions", "Piano lessons")).toHaveCount(1);
  expect(errors).toEqual([]);
});
