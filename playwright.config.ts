// playwright.config.ts — Prism in a real browser, on the example household
// (no keys: nothing real is ever linked), at a desktop width and at the
// 360px phone width DESIGN.md holds every screen to. Run after `pnpm build`:
// it serves the production build, as people get it.

import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: "pnpm start",
    url: `http://localhost:${PORT}/privacy`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // The example household only: whatever this machine has set, nothing real is linked.
    env: { PLAID_CLIENT_ID: "", PLAID_SECRET: "", COINBASE_CLIENT_ID: "", COINBASE_CLIENT_SECRET: "", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" },
  },
});
