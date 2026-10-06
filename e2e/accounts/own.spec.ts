// Adding what a bank can't see (a home, a car, a loan from family) is easy to
// find: a card of tiles on Net worth, a prompt on Overview until something is
// added, and links from Connections that open the form with the kind chosen.

import { watchErrors } from "../helpers";
import { expect, test } from "./fixtures";

test("a tile opens the form with its kind chosen, and Overview stops asking once something is in", async ({ page, account }) => {
  void account;
  const errors = watchErrors(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Add your home or car" }).click();
  await expect(page).toHaveURL(/\/net-worth#add$/);
  const card = page.locator("#add");
  await expect(card.getByRole("heading", { name: "Add what your bank can't see" })).toBeInViewport();

  await card.getByRole("button", { name: /^Add a vehicle/ }).click();
  const form = page.getByRole("dialog");
  await expect(form.getByRole("radio", { name: "A vehicle" })).toBeChecked();
  await form.getByLabel("Name").fill("2019 Honda Civic");
  await form.getByLabel("What it's worth today").fill("14500");
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(form).toBeHidden();

  await page.reload();
  await expect(page.getByText("2019 Honda Civic").first()).toBeVisible();
  // Something is in: the card says so, and moves below the accounts.
  await expect(page.locator("#add").getByRole("heading", { name: "Add more of what you own or owe" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Add your home or car" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Connections' home and car lead straight to the form, with that kind chosen", async ({ page, account }) => {
  void account;
  await page.goto("/connections");
  await page.getByRole("link", { name: "Add your home" }).click();
  const form = page.getByRole("dialog");
  await expect(form.getByRole("radio", { name: "A home" })).toBeChecked();
  // Opened once: the address no longer asks for it, so a refresh doesn't open it again.
  await expect(page).toHaveURL(/\/net-worth$/);
  await form.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/connections");
  await page.getByRole("link", { name: "Add your car" }).click();
  await expect(page.getByRole("dialog").getByRole("radio", { name: "A vehicle" })).toBeChecked();
});
