// Signing up, signing in and signing out, with the code from a real email
// (the local stack's Mailpit), and money that follows the account rather
// than the device it was added on.

import { watchErrors } from "../helpers";
import { codeFor, expect, household, importRows, newEmail, signIn, test } from "./fixtures";

test("a new account is made from the emailed code, asked its name, and signed out again", async ({ page }, info) => {
  const errors = watchErrors(page);
  const email = newEmail(info.project.name);
  const landed = await signIn(page, email);
  expect(landed.pathname + landed.search).toBe("/account?welcome=1");
  await expect(page.getByRole("heading", { name: "Welcome to Prism. What should we call you?" })).toBeVisible();
  await expect(page.getByText(`Signed in as ${email}.`)).toBeVisible();

  await page.getByLabel("First name").fill("Robin");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("Robin");

  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("/");
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in/);
  expect(errors).toEqual([]);
});

test("a mistyped code is refused in words, and the right one still works", async ({ page }, info) => {
  const email = newEmail(info.project.name);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  const sent = Date.now();
  await page.getByRole("button", { name: "Email me a code" }).click();
  const code = await codeFor(email, sent);
  const wrong = code.slice(0, -1) + String((Number(code.at(-1)) + 1) % 10);

  await page.getByLabel("Code from the email").fill(wrong);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#code-error")).toHaveText("That code didn't work. Check it, or send a new one — each code works once.");

  await page.getByLabel("Code from the email").fill(code);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/account\?welcome=1$/);
});

test("imported money replaces the example household, and follows the account to another device", async ({ page, browser, account, baseURL }) => {
  const errors = watchErrors(page);
  // The banner is in the page at every width (a phone shows it shorter).
  await expect(page.getByText("You're viewing a demo household")).toBeAttached();
  await importRows(page, household());

  await page.goto("/spending");
  await expect(page.getByText("You're viewing a demo household")).toHaveCount(0);
  await expect(page.getByText("Luigi's Trattoria").first()).toBeVisible();
  expect(errors).toEqual([]);

  // Another device: new cookies, nothing on it but the same sign-in.
  const other = await browser.newContext({ baseURL });
  const phone = await other.newPage();
  await signIn(phone, account.email);
  await phone.goto("/spending");
  await expect(phone.getByText("Luigi's Trattoria").first()).toBeVisible();
  await expect(phone.getByText("You're viewing a demo household")).toHaveCount(0);
  await other.close();
});
