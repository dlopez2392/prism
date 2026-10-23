// A change notice (legal-notice.ts, components/change-notice.tsx): told to
// everyone signed in, on every page, until they choose Got it on this device;
// never to someone signed out. While no notice is current, there's no bar.

import type { Page } from "@playwright/test";
import { currentNotice, noticeWords } from "../../src/lib/legal-notice";
import { translator } from "../../src/lib/i18n/translator";
import { watchErrors } from "../helpers";
import { expect, test } from "./fixtures";

const today = new Date().toISOString().slice(0, 10);
const notice = currentNotice(today);
const bar = (page: Page) => page.locator("section", { has: page.locator("#change-notice") });

test("a change notice shows on every page until Got it, then stays away", async ({ page, account }) => {
  void account;
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  if (!notice) {
    await expect(bar(page)).toHaveCount(0);
    return;
  }
  const { title, points } = noticeWords(notice, translator("en"));
  await expect(bar(page).getByRole("heading", { name: title })).toBeVisible();
  for (const p of points) await expect(bar(page).getByText(p, { exact: true })).toBeVisible();

  await page.goto("/spending");
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).getByRole("link", { name: "Read the Terms of Service" })).toHaveAttribute("href", "/terms");

  await bar(page).getByRole("button", { name: "Got it" }).click();
  await expect(bar(page)).toHaveCount(0);
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
