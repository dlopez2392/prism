// Prism in Spanish (lib/i18n): EN | ES in the top bar switches the words on
// the page at the same address and keeps the choice for the next visit, and a
// browser that asks for Spanish first gets it before anyone picks. Dates
// follow the language; amounts stay as a U.S. bank writes them.

import { expect, test } from "@playwright/test";
import { expectNoSidewaysScroll, watchErrors } from "./helpers";

test("EN | ES switches the page to Spanish at the same address, keeps it, and switches back", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/spending?range=3");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Español" }).click();
  await expect(page.locator("h1").first()).toHaveText("Gastos");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("button", { name: "Español" })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/\/spending\?range=3$/);
  await expect(page.getByRole("link", { name: "3 meses" })).toHaveAttribute("aria-current", "true");

  // Kept for the next visit, on every screen.
  await page.reload();
  await expect(page.locator("h1").first()).toHaveText("Gastos");
  await page.goto("/budgets");
  await expect(page.locator("h1").first()).toHaveText("Presupuestos");

  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator("h1").first()).toHaveText("Budgets");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(errors).toEqual([]);
});

test.describe("a browser that asks for Spanish first", () => {
  test.use({ locale: "es-MX" });

  const SCREENS: { path: string; title: RegExp; says: RegExp }[] = [
    { path: "/", title: /^(Buenos días|Buenas tardes|Buenas noches|Desvelándote), /, says: /Patrimonio neto/ },
    { path: "/spending", title: /^Gastos$/, says: /^Gastado en 6 meses$/ },
    { path: "/cash-flow", title: /^Flujo de efectivo$/, says: /Ahorraste/ },
    { path: "/budgets", title: /^Presupuestos$/, says: /Te queda para gastar en/ },
    { path: "/goals", title: /^Metas$/, says: /./ },
    { path: "/net-worth", title: /^Patrimonio neto$/, says: /^Patrimonio neto hoy$/ },
    { path: "/future", title: /^Futuro$/, says: /Disponible para gastar/ },
    { path: "/year", title: /^Tu \d{4}$/, says: /./ },
    { path: "/taxes", title: /^Tus impuestos de \d{4}$/, says: /./ },
    { path: "/connections", title: /^Conexiones$/, says: /Conectar un banco/ },
    { path: "/connections/import", title: /./, says: /./ },
    { path: "/connections/payments", title: /./, says: /./ },
    { path: "/connections/amazon", title: /./, says: /./ },
  ];

  for (const s of SCREENS) {
    test(`${s.path} reads in Spanish`, async ({ page }) => {
      const errors = watchErrors(page);
      const res = await page.goto(s.path);
      expect(res?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", "es");
      await expect(page.locator("h1").first()).toHaveText(s.title);
      await expect(page.getByText(s.says).filter({ visible: true }).first()).toBeVisible();
      // Spanish runs longer than English: still nothing scrolls sideways.
      await expectNoSidewaysScroll(page);
      expect(errors).toEqual([]);
    });
  }

  test("the one-month view names its months in Spanish, lower case mid-sentence", async ({ page }) => {
    await page.goto("/spending?range=1");
    await expect(page.getByRole("navigation", { name: "Mes" })).toBeVisible();
    // "vs. 1–5 sept" (or "vs. 1 sept" on the 2nd, "vs. septiembre" for a whole month), never "Sep 1 – 5".
    await expect(page.locator("[data-hero]").getByText(/^vs\. /)).toHaveText(/^vs\. ((\d{1,2}–)?\d{1,2} [a-z]+|[a-z]+)$/);
  });

  test("a screen not yet in Spanish says its words are English, so a screen reader reads them in an English voice", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(page.getByRole("main").locator("[lang=en]").first()).toContainText("Privacy");
    await page.goto("/budgets");
    await expect(page.getByRole("main").locator("[lang=en]")).toHaveCount(0);
  });
});
