// Getting started on Overview (finance/setup.ts, components/setup-checklist.tsx):
// a signed-in person's own steps, each done by the thing itself, and Hide puts
// the card away on this device for good.

import type { Page } from "@playwright/test";
import { watchErrors } from "../helpers";
import { expect, importRows, test } from "./fixtures";

const card = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "Getting started", exact: true }) });
const step = (page: Page, name: string) => card(page).getByRole("link", { name: new RegExp(`^${name}`) });

test("getting started counts what's done by the thing itself, and Hide puts it away", async ({ page, account }) => {
  void account;
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByText(/^0 of \d done$/)).toBeVisible();
  await expect(step(page, "Connect a bank")).not.toContainText("Done");
  await expect(card(page).getByRole("heading", { name: "If it applies to you" })).toBeVisible();

  // History of their own counts as a bank: the first step is done.
  await importRows(page);
  await page.goto("/");
  await expect(step(page, "Connect a bank")).toContainText("Done");
  await expect(card(page).getByText(/^1 of \d done$/)).toBeVisible();

  // Each step goes where it's done.
  await step(page, "Set your budgets").click();
  await expect(page).toHaveURL(/\/budgets$/);

  // Hidden, it stays hidden after a reload.
  await page.goto("/");
  await card(page).getByRole("button", { name: "Hide" }).click();
  await expect(card(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator("h1")).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
