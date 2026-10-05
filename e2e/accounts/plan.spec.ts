// The person's plan, kept in their account rather than the browser: budgets
// and goals follow them to another device, and a debt they added by hand is
// planned with the same arithmetic as a lender's (payoff.ts).

import type { Browser, Page } from "@playwright/test";
import { watchErrors } from "../helpers";
import { expect, importRows, signIn, test } from "./fixtures";

/** A second browser with nothing in it, signed in to the same account. */
async function anotherDevice(browser: Browser, baseURL: string | undefined, email: string): Promise<Page> {
  const page = await (await browser.newContext({ baseURL })).newPage();
  await signIn(page, email);
  return page;
}

test("budgets and a goal are kept in the account, and follow it to another device", async ({ page, browser, account, baseURL }) => {
  const errors = watchErrors(page);
  await importRows(page);

  // Imported history drafts no budgets, so the page starts by asking for one.
  await page.goto("/budgets");
  await page.getByRole("button", { name: "Set a budget" }).first().click();
  await page.getByLabel("Food & dining monthly budget").fill("650");
  await page.getByRole("button", { name: "Save budgets" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.goto("/goals");
  await page.getByRole("button", { name: /^(Add a goal|New goal)$/ }).click();
  await page.getByLabel("What are you saving for?").fill("Emergency fund");
  await page.getByLabel("Target").fill("5000");
  await page.getByLabel("Saved so far", { exact: true }).fill("1200");
  await page.getByLabel("Each month").fill("300");
  await page.getByRole("button", { name: "Add goal" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(errors).toEqual([]);

  const other = await anotherDevice(browser, baseURL, account.email);
  await other.goto("/goals");
  await expect(other.getByText("Emergency fund").first()).toBeVisible();
  await other.goto("/budgets");
  await other.getByRole("button", { name: "Edit budgets" }).click();
  await expect(other.getByLabel("Food & dining monthly budget")).toHaveValue("650");
  await other.context().close();
});

test("money owed that was added by hand is planned once its rate and payment are given", async ({ page, account }) => {
  void account;
  const errors = watchErrors(page);
  await importRows(page);

  await page.goto("/net-worth");
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await page.getByText("Money you owe", { exact: true }).click();
  await page.getByLabel("Name").fill("Loan from Mom");
  await page.getByLabel("How much you owe today").fill("3000");
  await page.getByRole("button", { name: "Add", exact: true }).last().click();
  await expect(page.getByRole("dialog")).toBeHidden();

  // Nothing about this debt is guessed: it's asked for, then planned.
  const card = page.locator("section", { hasText: "Paying off what you owe" }).last();
  await expect(card.getByText("Loan from Mom").first()).toBeVisible();
  await expect(card.getByText(/Add the yearly rate and monthly payment/)).toBeVisible();
  await card.getByLabel("Yearly rate").fill("0");
  await card.getByLabel("Pays each month").fill("250");
  await expect(card.getByText(/^Debt-free \w{3} \d{4}$/).first()).toBeVisible();
  expect(errors).toEqual([]);
});
