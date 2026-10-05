// Amazon orders, end to end, as a signed-in person adds them: their order
// history is chosen on Connections → Amazon orders (read in the browser,
// never uploaded), the charges it matches are kept in the account, and on
// Spending each charge says what it paid for, is found by an item's name,
// and splits by its items.

import type { Page } from "@playwright/test";
import { watchErrors } from "../helpers";
import { daysAgo, expect, household, importRows, test } from "./fixtures";

const HEADER =
  '"Website","Order ID","Order Date","Purchase Order Number","Currency","Unit Price","Unit Price Tax","Shipping Charge","Total Discounts","Total Owed","Shipment Item Subtotal","Shipment Item Subtotal Tax","ASIN","Product Condition","Quantity","Payment Instrument Type","Order Status","Shipment Status","Ship Date","Shipping Option","Shipping Address","Billing Address","Carrier Name & Tracking Number","Product Name","Gift Message","Gift Sender Name","Gift Recipient Contact Details","Item Serial Number"';
const item = (order: string, ordered: string, shipped: string, owed: string, name: string, qty = 1) =>
  [
    "Amazon.com", order, `${ordered}T15:04:05Z`, "Not Applicable", "USD", owed, "0", "0", "0", owed, owed, "0", "B000000000", "New", String(qty), "Visa - 1234", "Closed", "Shipped",
    `${shipped}T20:11:00.000Z`, "std-us", "1 Main St", "1 Main St", "AMZN_US(TBA000)", name, "Not Available", "Not Available", "Not Available", "Not Available",
  ]
    .map((c) => `"${c}"`)
    .join(",");

/** Chooses the order history through the page's own button and file picker, as a person does. */
async function chooseFile(page: Page, text: string) {
  await expect(async () => {
    const picker = page.waitForEvent("filechooser", { timeout: 2_000 }).catch(() => null);
    await page.getByRole("button", { name: "Choose the file" }).click();
    const chooser = await picker;
    if (!chooser) throw new Error("The file picker didn't open yet.");
    await chooser.setFiles({ name: "Retail.OrderHistory.1.csv", mimeType: "text/csv", buffer: Buffer.from(text) });
  }).toPass({ timeout: 20_000 });
}

test("an Amazon charge says what it paid for, is found by an item, and splits by its items", async ({ page, account }) => {
  void account;
  const errors = watchErrors(page);
  // The person's card: their usual month, and two Amazon charges, each a shipment.
  await importRows(page, [
    ...household(),
    { date: daysAgo(9), merchant: "AMZN Mktp US*2K4AB", category: "Shopping", amount: -34.97 },
    { date: daysAgo(6), merchant: "AMAZON.COM*9Z8Y7", category: "Shopping", amount: -31.5 },
  ]);
  const orders = [
    HEADER,
    item("111-0000001-0000001", daysAgo(12), daysAgo(10), "24.99", "Dog food, 12 lb bag"),
    item("111-0000001-0000001", daysAgo(12), daysAgo(10), "9.98", "USB-C cable", 2),
    item("111-0000002-0000002", daysAgo(8), daysAgo(7), "31.50", "Desk lamp"),
    // Paid some other way: nothing on the card to match.
    item("111-0000003-0000003", daysAgo(8), daysAgo(7), "12.00", "Gift wrap"),
  ].join("\n");

  await page.goto("/connections/amazon");
  await chooseFile(page, orders);
  await expect(page.getByRole("heading", { name: "2 Amazon charges matched to your bank" })).toBeVisible();
  await expect(page.getByText("Dog food, 12 lb bag, USB-C cable")).toBeVisible();
  await expect(page.getByText(/1 order matched no line/)).toBeVisible();
  await page.getByRole("button", { name: "Keep 2 charges" }).click();
  await expect(page.getByRole("status").getByText(/2 Amazon charges now say what they paid for/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "2 Amazon charges say what they paid for" })).toBeVisible();

  // On Spending, found by what was bought.
  await page.goto("/spending?range=3");
  await page.getByPlaceholder(/Search a merchant/).fill("dog food");
  const charge = page.getByRole("button", { name: /^Open AMZN Mktp US\*2K4AB, Dog food, 12 lb bag, USB-C cable,/ });
  await expect(charge).toHaveCount(1);

  // Split by its items: one part each, named, the person choosing each one's category.
  await charge.click();
  await page.getByRole("tab", { name: "Split, tags, owed" }).click();
  await page.getByRole("button", { name: /Split by its 2 items/ }).click();
  await expect(page.getByRole("combobox", { name: "Part 1 category, Dog food, 12 lb bag" })).toBeVisible();
  await page.getByRole("combobox", { name: "Part 2 category, USB-C cable" }).selectOption({ label: "Other" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: /^Open AMZN Mktp US\*2K4AB, .*part 1 of 2/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Open AMZN Mktp US\*2K4AB, .*: Other, part 2 of 2/ })).toHaveCount(1);
  expect(errors).toEqual([]);
});
