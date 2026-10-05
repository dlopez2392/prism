// Leaving things out of the totals, saved to the account (sealed in
// profiles.sealed_txn_details) and read back after a reload: one purchase from
// the transaction's own switch, and a whole account from Net worth's "Choose
// what counts". Either stays listed and counts in no total until it's
// switched back.

import type { Page } from "@playwright/test";
import { watchErrors } from "../helpers";
import { expect, importRows, test } from "./fixtures";

/** What Spending's headline says was spent, in whole dollars. */
async function spent(page: Page): Promise<number> {
  const amount = await page.locator("[data-hero]").getByText(/^\$[\d,]+$/).first().innerText();
  return Number(amount.replace(/[$,]/g, ""));
}

test("a dinner left out of the totals stays listed, counts nowhere, and counts again when switched back", async ({ page, account }) => {
  void account;
  const errors = watchErrors(page);
  await importRows(page);
  await page.goto("/spending?range=3");
  const before = await spent(page);

  // The newest dinner, $120: the ledger lists newest first.
  await page.getByRole("button", { name: /^Open Luigi's Trattoria,/ }).first().click();
  const out = page.getByRole("switch", { name: "Leave out of my totals" });
  await expect(out).toHaveAttribute("aria-checked", "false");
  await out.click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect.poll(() => spent(page)).toBe(before - 120);

  // Saved to the account: a fresh load reads it back, still listed and marked.
  await page.reload();
  expect(await spent(page)).toBe(before - 120);
  const row = page.getByRole("button", { name: /^Open Luigi's Trattoria, .*left out of your totals/ });
  await expect(row).toHaveCount(1);
  await expect(page.getByText("Left out of totals", { exact: true })).toHaveCount(1);

  // Switched back, it counts again.
  await row.click();
  await expect(out).toHaveAttribute("aria-checked", "true");
  await out.click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect.poll(() => spent(page)).toBe(before);
  await expect(page.getByText("Left out of totals", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("an account left out takes its balance and every line in it out of the totals, and comes back", async ({ page, account }) => {
  void account;
  const errors = watchErrors(page);
  await importRows(page);
  await page.goto("/spending?range=3");
  const before = await spent(page);
  expect(before).toBeGreaterThan(0);

  await page.goto("/net-worth");
  await page.getByRole("button", { name: "Choose what counts" }).click();
  const checking = page.getByRole("dialog").getByRole("switch", { name: "Everyday Checking" });
  await expect(checking).toHaveAttribute("aria-checked", "true");
  await checking.click();
  // Its only account left out: Net worth says so, and offers it back.
  await expect(page.getByText("Every account is left out of your totals")).toBeVisible();
  await expect(page.getByText("Left out of your totals", { exact: true })).toBeVisible();

  // Nothing in it counts, and every line is still there.
  await page.goto("/spending?range=3");
  expect(await spent(page)).toBe(0);
  await page.getByRole("button", { name: /^Open Luigi's Trattoria, .*left out of your totals/ }).first().click();
  // Left out with its account: the line's own switch says so, and only the account's brings it back.
  const own = page.getByRole("switch", { name: "Leave out of my totals" });
  await expect(own).toHaveAttribute("aria-checked", "true");
  await expect(own).toBeDisabled();
  await expect(page.getByText(/Its whole account is left out of your totals/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.goto("/net-worth");
  await page.getByRole("button", { name: "Choose what counts" }).click();
  await page.getByRole("dialog").getByRole("switch", { name: "Everyday Checking" }).click();
  await expect(page.getByText("Every account is left out of your totals")).toHaveCount(0);
  await page.goto("/spending?range=3");
  expect(await spent(page)).toBe(before);
  expect(errors).toEqual([]);
});
