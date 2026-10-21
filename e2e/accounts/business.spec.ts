// Business categories (finance/schedule-c.ts, details-actions.ts sortBusinessLine,
// sealed in profiles.sealed_txn_details): once an account is marked as
// business, /business sorts every line in it by where it goes on Schedule C.
// A line moves with every line from its shop, or on its own, takes effect at
// once with an Undo, and is read back after a reload.

import type { Page } from "@playwright/test";
import { watchErrors } from "../helpers";
import { expect, importRows, test } from "./fixtures";

/** The card for one place on the page, by its heading. */
const place = (page: Page, name: string) => page.locator("article", { has: page.getByRole("heading", { name, exact: true }) });

/** That card with its transactions showing: opened only if it isn't already. */
async function open(page: Page, name: string) {
  const card = place(page, name);
  if ((await card.locator("details").getAttribute("open")) === null) await card.locator("summary").click();
  await expect(card.locator("details")).toHaveAttribute("open", "");
  return card;
}

test("a business account's lines are sorted by Schedule C line, and moving them is kept", async ({ page, account }) => {
  void account;
  const errors = watchErrors(page);
  await importRows(page);
  await page.goto("/net-worth");
  await page.getByRole("button", { name: "Choose what counts" }).click();
  await page.getByRole("dialog").getByRole("checkbox", { name: "This is a business account" }).check();
  await expect(page.getByRole("region", { name: "Business accounts" })).toBeVisible();
  await page.getByRole("link", { name: "Sort their money for Schedule C" }).click();

  await expect(page.locator("h1")).toHaveText(/^Your \d{4} business$/);
  await expect(page.locator("[data-hero]")).toHaveCount(1);
  // Prism's guesses: pay in is sales, the rent is rent, the dinners and the groceries are meals, the gas is the car.
  for (const name of ["Line 1 · Sales and gross receipts", "Line 20b · Rent or lease", "Line 24b · Meals", "Line 9 · Car and truck"]) await expect(place(page, name)).toBeVisible();
  await expect(page.getByText(/^Prism sorted \d+ lines by its own guess/)).toBeVisible();

  // Every Fresh Market line, moved at once: they weren't the business's.
  let meals = await open(page, "Line 24b · Meals");
  const groceries = await meals.getByRole("combobox", { name: /^Where Fresh Market on / }).count();
  expect(groceries).toBeGreaterThan(1);
  await meals.getByRole("combobox", { name: /^Where Fresh Market on / }).first().selectOption({ label: "Not the business's" });
  await expect(page.getByText("Every Fresh Market line like it goes under Not the business's now.")).toBeVisible();
  await expect(place(page, "Not the business's").getByText(`${groceries} transactions`, { exact: true })).toBeVisible();

  // Undo puts them back with the meals.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(place(page, "Not the business's")).toHaveCount(0);

  // Again, and one dinner on its own to office expense; both are read back after a reload.
  meals = await open(page, "Line 24b · Meals");
  await meals.getByRole("combobox", { name: /^Where Fresh Market on / }).first().selectOption({ label: "Not the business's" });
  await expect(place(page, "Not the business's")).toBeVisible();
  meals = await open(page, "Line 24b · Meals");
  await meals.getByRole("checkbox", { name: "Every Luigi's Trattoria" }).first().uncheck();
  await meals.getByRole("combobox", { name: /^Where Luigi's Trattoria on / }).first().selectOption({ label: "Line 18 · Office expense" });
  await expect(page.getByText("Moved to Line 18 · Office expense.")).toBeVisible();

  await page.reload();
  await expect(place(page, "Not the business's").getByText(`${groceries} transactions`, { exact: true })).toBeVisible();
  const office = await open(page, "Line 18 · Office expense");
  await expect(office.getByText("1 transaction", { exact: true })).toBeVisible();
  await expect(office.getByText("You put it here", { exact: false })).toBeVisible();
  // The other dinner is still a meal.
  await expect(place(page, "Line 24b · Meals").getByText("1 transaction", { exact: true })).toBeVisible();

  // Taxes carries the year by line, and the business's pay isn't in the personal sections.
  await page.goto("/taxes");
  const card = page.locator("article", { has: page.getByRole("heading", { name: "Schedule C", exact: true }) });
  await expect(card.getByRole("rowheader", { name: "Line 18 · Office expense" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pay", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
