// What a visitor can do on the example household, end to end: try a
// purchase on Future and see the bills that don't come monthly, plan paying
// off the loans on Net worth, read the tax summary year by year, and search
// the ledger, including from a link that names what to look for; and find
// the link for an investment account beside the bank's on Connections.

import { expect, test } from "@playwright/test";

test("Connections offers an investment account beside a bank, and on the example household says there's nothing to link", async ({ page }) => {
  await page.goto("/connections");
  // Beside "Connect a bank" in the card at the top, and again under Investing.
  const links = page.getByRole("button", { name: "Connect an investment account" });
  await expect(links).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Connect a bank" }).first()).toBeVisible();
  // It asks for an investment account, and this deployment has no Plaid keys: the example household explains itself.
  const asked = page.waitForRequest((r) => r.url().endsWith("/api/plaid/link-token") && r.method() === "POST");
  await links.first().click();
  expect((await asked).postDataJSON()).toMatchObject({ kind: "investments", from: "/connections" });
  await expect(page.getByRole("dialog").getByRole("heading", { name: "You're exploring a demo household" })).toBeVisible();
});

test("Can I afford it? answers as you type, and says when it doesn't fit", async ({ page }) => {
  await page.goto("/future");
  const card = page.locator("section", { hasText: "Can I afford it?" });
  await card.getByLabel("How much?").fill("50");
  await expect(card.getByText("Fits", { exact: true })).toBeVisible();
  await card.getByLabel("How much?").fill("999999");
  await expect(card.getByText("Doesn't fit", { exact: true })).toBeVisible();
  await expect(card.getByText(/below zero/)).toBeVisible();
  await card.getByRole("button", { name: "A new monthly bill" }).click();
  await expect(card.getByRole("button", { name: "A new monthly bill" })).toHaveAttribute("aria-pressed", "true");
  await card.getByLabel("How much a month?").fill("abc");
  await expect(card.getByText(/Type an amount in dollars/)).toBeVisible();
});

test("Future lists the bills that don't come monthly, with what to put aside for them", async ({ page }) => {
  await page.goto("/future");
  const card = page.locator("section", { hasText: "Bills that don't come every month" });
  await expect(card.getByText(/^Put aside \$\d+ a month and they're paid for when they land$/)).toBeVisible();
  for (const name of ["Clearwater Water & Sewer", "ClearSight Lenses", "Parcelpass membership"]) {
    await expect(card.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(card.getByText(/^Every three months · next/)).toBeVisible();
  await expect(card.getByText(/^Twice a year · next/)).toBeVisible();
  await expect(card.getByText(/^Every year · next/)).toBeVisible();
});

test("the payoff plan compares both orders, follows the one picked, and asks for a missing rate", async ({ page }) => {
  await page.goto("/net-worth");
  const card = page.locator("section", { hasText: "Paying off what you owe" }).last();
  await card.getByLabel("Extra each month, on top").fill("200");
  const order = card.getByRole("list").last();
  await expect(card.getByRole("button", { name: /Highest rate first/ })).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByText(/^Debt-free \w{3} \d{4}$/).first()).toBeVisible();
  await expect(order.getByRole("listitem").first()).toContainText("Auto loan");
  await card.getByRole("button", { name: /Smallest balance first/ }).click();
  await expect(order.getByRole("listitem").first()).toContainText("Student loan");
  await card.getByLabel("Yearly rate").first().fill("");
  await expect(card.getByText("Its yearly rate, like 6.9")).toBeVisible();
  await expect(card.getByText(/Add the yearly rate and monthly payment/)).toBeVisible();
});

test("the tax summary moves between years and shows the transactions behind a section", async ({ page }) => {
  await page.goto("/taxes");
  const heading = page.locator("h1");
  const first = await heading.innerText();
  const tabs = page.getByRole("navigation", { name: "Tax year" });
  const other = tabs.locator("a:not([aria-current])").first();
  const year = await other.innerText();
  await other.click();
  await expect(heading).toHaveText(`Your ${year} taxes`);
  expect(first).not.toBe(`Your ${year} taxes`);
  const show = page.getByText(/^Show the \d+ transactions$/).first();
  await show.click();
  await expect(page.locator("details[open] li").first()).toBeVisible();
});

test("the ledger narrows as you search, and opens narrowed from a link that names a merchant", async ({ page }) => {
  await page.goto("/spending?range=12");
  const count = page.getByText(/^\d[\d,]* transactions?$/);
  const all = Number((await count.innerText()).replace(/\D/g, ""));
  await page.getByPlaceholder(/Search a merchant/).fill("green basket");
  await expect(count).not.toHaveText(`${all.toLocaleString("en-US")} transactions`);
  const some = Number((await count.innerText()).replace(/\D/g, ""));
  expect(some).toBeGreaterThan(0);
  expect(some).toBeLessThan(all);

  await page.goto("/spending?range=12#find=green%20basket");
  await expect(page.getByPlaceholder(/Search a merchant/)).toHaveValue("green basket");
  await expect(count).toHaveText(`${some.toLocaleString("en-US")} ${some === 1 ? "transaction" : "transactions"}`);
});

test("the year page leads to the tax summary for the same year", async ({ page }) => {
  await page.goto("/year");
  const year = (await page.locator("h1").innerText()).match(/\d{4}/)![0];
  await page.getByRole("link", { name: `See ${year} for your taxes` }).click();
  await expect(page).toHaveURL(new RegExp(`/taxes\\?y=${year}$`));
  await expect(page.locator("h1")).toHaveText(`Your ${year} taxes`);
});
