// The Account page's settings that the database enforces: alert emails
// (profiles.alert_kinds and its check constraint) and two-step sign-in, which
// row-level security holds to (second_step_pending) once it's on.

import { watchErrors } from "../helpers";
import { codeFor, expect, test, totp } from "./fixtures";

test("alert email choices are kept in the account", async ({ page, account }) => {
  void account;
  const errors = watchErrors(page);
  await page.goto("/account");
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Alert emails" }) });
  await card.getByRole("checkbox", { name: /Email me alerts/ }).check();
  await card.getByRole("checkbox", { name: /Show dollar amounts/ }).uncheck();
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(card.getByRole("status").last()).not.toBeEmpty();

  await page.reload();
  await expect(card.getByRole("checkbox", { name: /Email me alerts/ })).toBeChecked();
  await expect(card.getByRole("checkbox", { name: /Show dollar amounts/ })).not.toBeChecked();
  expect(errors).toEqual([]);
});

test("two-step sign-in, once on, is asked for after the email code, and nothing opens without it", async ({ page, account }) => {
  // Up to one 30-second step is spent waiting for a code the app hasn't shown yet.
  test.setTimeout(90_000);
  await page.goto("/account");
  await page.getByRole("button", { name: "Set up two-step sign-in" }).click();
  const secret = (await page.locator("code").filter({ hasText: /^[A-Z2-7 ]{16,}$/ }).textContent())!.replace(/\s/g, "");
  const step = () => Math.floor(Date.now() / 30_000);
  const first = step();
  await page.getByLabel("Code from the app").fill(totp(secret));
  await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await expect(page.getByText("On", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("/");
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(account.email);
  const sent = Date.now();
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("Code from the email").fill(await codeFor(account.email, sent));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/sign-in\/two-step/);

  // Halfway in is not in: the account's pages send the person back to finish.
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\/two-step/);

  // A code the app shows next, never the one already used.
  while (step() === first) await page.waitForTimeout(1_000);
  await page.getByLabel("Code from your authenticator app").fill(totp(secret));
  await page.getByRole("button", { name: "Finish signing in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
  await page.goto("/account");
  await expect(page.getByText(`Signed in as ${account.email}.`)).toBeVisible();
});
