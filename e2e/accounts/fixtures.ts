// e2e/accounts/fixtures.ts — what every signed-in browser test starts from:
// a brand-new account, made the way a person makes one (their email, then the
// code from the email), on the local stack only (stack.ts). Each test gets its
// own account, so tests never share money, plans or settings and can run in
// any order, side by side.

import { createHmac, randomUUID } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import { localStack } from "./stack";

const stack = localStack();

/** A fresh address for a fresh account. example.com is reserved: no mail can ever leave for it, and Mailpit keeps it anyway. */
export function newEmail(tag: string): string {
  return `e2e-${tag}-${randomUUID().slice(0, 8)}@example.com`;
}

type MailpitList = { messages?: { ID: string; Created: string }[] };

/** Every email the local stack's Mailpit holds for `email`, newest first. */
async function inbox(email: string): Promise<{ ID: string }[]> {
  if (!stack) throw new Error("No local Supabase stack.");
  const search = `${stack.mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`;
  return ((await (await fetch(search)).json()) as MailpitList).messages ?? [];
}

/** The emails `email` already has: ask before sending a code, so the code's own email can't be mistaken for an older one. */
export async function mailSeen(email: string): Promise<Set<string>> {
  return new Set((await inbox(email)).map((m) => m.ID));
}

/** The code in the sign-in email to `email` that isn't one of `seen`, read from the local stack's Mailpit. */
export async function codeFor(email: string, seen: Set<string>): Promise<string> {
  if (!stack) throw new Error("No local Supabase stack.");
  for (let tries = 0; tries < 80; tries++) {
    // Told apart by id, never by time: no clock can make an older email look new.
    const fresh = (await inbox(email)).find((m) => !seen.has(m.ID));
    if (fresh) {
      const { Text } = (await (await fetch(`${stack.mailpit}/api/v1/message/${fresh.ID}`)).json()) as { Text: string };
      const code = /code to sign in:\D*(\d{6,10})/.exec(Text)?.[1];
      if (!code) throw new Error("The sign-in email carried no code.");
      return code;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No sign-in email reached ${email}.`);
}

/** Signs in (or up) through the form; returns where Prism sent the person afterwards. */
export async function signIn(page: Page, email: string): Promise<URL> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  const seen = await mailSeen(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("Code from the email").fill(await codeFor(email, seen));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  try {
    // As soon as the address changes: the page it lands on is the test's to wait for.
    await page.waitForURL((u) => u.pathname !== "/sign-in", { waitUntil: "commit", timeout: 20_000 });
  } catch (e) {
    // Prism refusing the code says so on the form; that, not a timeout, is what to report.
    const said = await page.locator("#code-error").textContent({ timeout: 1_000 }).catch(() => null);
    throw new Error(said ? `Sign-in refused the emailed code: ${said}` : (e as Error).message);
  }
  return new URL(page.url());
}

export type Account = { email: string };

export const test = base.extend<{ account: Account }>({
  // Playwright's own name for this argument is `use`, which React's lint rules take for a hook.
  account: async ({ page }, provide, info) => {
    const email = newEmail(info.project.name);
    await signIn(page, email);
    await provide({ email });
  },
});

export { expect };

/**
 * The code an authenticator app shows for `secret` (base32) at `at`: RFC 6238,
 * HMAC-SHA1, six digits, thirty-second steps, as Supabase Auth checks it.
 */
export function totp(secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/[\s=]/g, "").toUpperCase()].map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const at4 = mac[mac.length - 1]! & 0xf;
  return String((mac.readUInt32BE(at4) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** A day `n` days before today, as an import file writes it. */
export function daysAgo(n: number, today = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - n));
  return d.toISOString().slice(0, 10);
}

export type Row = { date: string; merchant: string; category: string; amount: number };

/**
 * About four months of one person's checking account, every date counted back
 * from today so the screens always have a recent month to show: pay twice a
 * month, rent, a weekly grocery shop, a streaming bill, fuel, and two dinners
 * out (the lines the split tests split).
 */
export function household(today = new Date()): Row[] {
  const rows: Row[] = [];
  for (let n = 1; n <= 120; n++) {
    const date = daysAgo(n, today);
    const dom = Number(date.slice(8));
    if (dom === 1 || dom === 15) rows.push({ date, merchant: "Acme Payroll", category: "Paycheck", amount: 2400 });
    if (dom === 3) rows.push({ date, merchant: "Maple Street Rentals", category: "Rent", amount: -1450 });
    if (dom === 12) rows.push({ date, merchant: "Streamflix", category: "Entertainment", amount: -15.49 });
    if (n % 7 === 2) rows.push({ date, merchant: "Fresh Market", category: "Groceries", amount: -86.4 });
    if (n % 14 === 5) rows.push({ date, merchant: "Shell", category: "Gas", amount: -45.1 });
  }
  rows.push({ date: daysAgo(4, today), merchant: "Luigi's Trattoria", category: "Restaurants", amount: -120 });
  rows.push({ date: daysAgo(33, today), merchant: "Luigi's Trattoria", category: "Restaurants", amount: -96.5 });
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

/** The rows as a Monarch-style export: the first format Prism's importer recognises. */
export function csvOf(rows: Row[], account = "Everyday Checking"): string {
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return ["Date,Merchant,Category,Account,Amount", ...rows.map((r) => [r.date, cell(r.merchant), cell(r.category), cell(account), r.amount.toFixed(2)].join(","))].join("\n");
}

/** Imports `rows` through Connections → Import a file, as a person would, and waits until they're saved. */
export async function importRows(page: Page, rows: Row[] = household()): Promise<void> {
  await page.goto("/connections/import");
  await page.locator('input[type="file"]').setInputFiles({ name: "checking.csv", mimeType: "text/csv", buffer: Buffer.from(csvOf(rows)) });
  await page.getByRole("button", { name: "Next: check the accounts" }).click();
  await page.getByRole("button", { name: `Import ${rows.length} transactions` }).click();
  await expect(page.getByRole("heading", { name: `${rows.length} transactions imported from 1 account` })).toBeVisible({ timeout: 30_000 });
}
