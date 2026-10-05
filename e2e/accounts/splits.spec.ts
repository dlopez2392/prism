// Splits, tags and who owes you, saved to the account (sealed in
// profiles.sealed_txn_details) and read back after a reload: the Spending
// page end to end, as a signed-in person uses it.

import type { Page } from "@playwright/test";
import { watchErrors } from "../helpers";
import { expect, importRows, test } from "./fixtures";

/** Opens the newest purchase at `shop` and switches to its split, tags and owed tab. */
async function openDetails(page: Page, shop: string) {
  await page.getByRole("button", { name: new RegExp(`^Open ${shop},`) }).first().click();
  await page.getByRole("tab", { name: "Split, tags, owed" }).click();
}

/** Saves the open dialog and waits for it to close: the save has landed when it does. */
async function save(page: Page) {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

test("a dinner split, tagged and owed is kept, and the reminder is handed to the share sheet", async ({ page, account }) => {
  void account;
  const errors = watchErrors(page);
  // The share sheet, as a phone has it: what Prism hands it is what the person would send.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data: ShareData) => void ((window as unknown as { shared: ShareData[] }).shared ??= []).push(data) });
  });
  await importRows(page);
  await page.goto("/spending");
  await expect(page.getByText("Nobody owes you right now")).toBeVisible();

  await openDetails(page, "Luigi's Trattoria");
  await page.getByRole("checkbox", { name: /Split across categories/ }).check();
  await page.getByRole("combobox", { name: "Part 2 category" }).selectOption({ label: "Fun" });
  await page.getByRole("textbox", { name: "Part 2 amount" }).fill("40");
  await page.getByRole("textbox", { name: "Tags" }).fill("Birthday");
  await page.getByRole("checkbox", { name: "Someone owes me for this" }).check();
  await page.getByRole("textbox", { name: "Who" }).fill("Sam");
  await page.getByRole("textbox", { name: "How much" }).fill("60");
  await save(page);

  // Saved to the account: a fresh load reads it back.
  await page.reload();
  const remind = page.getByRole("button", { name: "Remind Sam about $60.00 for Luigi's Trattoria" });
  await expect(remind).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open Luigi's Trattoria, .*part 1 of 2/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Open Luigi's Trattoria, .*part 2 of 2/ })).toHaveCount(1);
  await expect(page.getByText("Birthday").first()).toBeVisible();

  await remind.click();
  const shared = await page.evaluate(() => (window as unknown as { shared?: ShareData[] }).shared ?? []);
  expect(shared).toHaveLength(1);
  expect(shared[0]!.text).toContain("$60.00");
  expect(shared[0]!.text).toContain("Luigi's Trattoria");

  // Paid back goes at once, and Undo puts it back.
  await page.getByRole("button", { name: "Sam paid you back $60.00 for Luigi's Trattoria" }).click();
  await expect(remind).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(remind).toBeVisible();
  expect(errors).toEqual([]);
});

test("a split that follows a shop reaches its other purchases, and Remove has an Undo", async ({ page, account }) => {
  void account;
  const errors = watchErrors(page);
  await importRows(page);
  await page.goto("/spending");

  await openDetails(page, "Fresh Market");
  await page.getByRole("checkbox", { name: /Split across categories/ }).check();
  await page.getByRole("combobox", { name: "Part 2 category" }).selectOption({ label: "Shopping" });
  await page.getByRole("textbox", { name: "Part 2 amount" }).fill("21.60");
  await page.getByRole("checkbox", { name: "Split every Fresh Market purchase this way" }).check();
  await save(page);

  await page.reload();
  await expect(page.getByText("Every Fresh Market purchase", { exact: true })).toBeVisible();
  // Every Fresh Market purchase is split now, not only the one opened.
  const shown = await page.getByRole("button", { name: /^Open Fresh Market,/ }).count();
  await expect(page.getByRole("button", { name: /^Open Fresh Market, .*part 2 of 2/ })).toHaveCount(shown / 2);

  await page.getByRole("button", { name: "Stop splitting Fresh Market purchases" }).click();
  await expect(page.getByText("Every Fresh Market purchase", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Every Fresh Market purchase", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
