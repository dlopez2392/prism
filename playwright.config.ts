// playwright.config.ts — Prism in a real browser, at a desktop width and at
// the 360px phone width DESIGN.md holds every screen to. Run after
// `pnpm build`: it serves the production build, as people get it.
//
// Two servers from the same build:
//   - port 3100, the example household (no keys: nothing real is ever linked);
//   - port 3101, accounts switched on against the LOCAL Supabase stack only
//     (e2e/accounts/stack.ts refuses anything else), for the signed-in tests
//     in e2e/accounts/. Each of those signs up its own fresh account. The
//     vault key is made up for this run and forgotten with it.
//
// Alert emails are switched on for the signed-in server so their settings can
// be tested, with a placeholder Resend key and a job secret made up here and
// handed to no test: the job (/api/cron/alerts) is the only thing that sends,
// and nothing in the run can call it.

import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { localStack, refuseProduction } from "./e2e/accounts/stack";

const DEMO_PORT = 3100;
const ACCOUNTS_PORT = 3101;

/** Every service Prism could reach on someone's behalf: off for both servers, whatever this machine has set. */
const NOTHING_REAL = {
  PLAID_CLIENT_ID: "",
  PLAID_SECRET: "",
  COINBASE_CLIENT_ID: "",
  COINBASE_CLIENT_SECRET: "",
  RENTCAST_API_KEY: "",
  ALCHEMY_API_KEY: "",
  RESEND_API_KEY: "",
  CRON_SECRET: "",
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
  VERCEL_ENV: "",
};

const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } };
const phone = { ...devices["Desktop Chrome"], viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true };

const stack = localStack();
const accountsEnv = stack && {
  ...NOTHING_REAL,
  NEXT_PUBLIC_SUPABASE_URL: stack.url,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: stack.key,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  PRISM_VAULT_KEY: randomBytes(32).toString("base64"),
  PRISM_VAULT_KEY_2: "",
  RESEND_API_KEY: "re_e2e_placeholder_never_sent",
  CRON_SECRET: randomBytes(32).toString("base64url"),
};
if (accountsEnv) refuseProduction(accountsEnv);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${DEMO_PORT}`,
    trace: "retain-on-failure",
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    { name: "desktop", testIgnore: "accounts/**", use: desktop },
    { name: "phone", testIgnore: "accounts/**", use: phone },
    ...(stack
      ? [
          { name: "accounts-desktop", testMatch: "accounts/**/*.spec.ts", use: { ...desktop, baseURL: `http://localhost:${ACCOUNTS_PORT}` } },
          { name: "accounts-phone", testMatch: "accounts/**/*.spec.ts", use: { ...phone, baseURL: `http://localhost:${ACCOUNTS_PORT}` } },
        ]
      : []),
  ],
  webServer: [
    {
      command: "pnpm start",
      url: `http://localhost:${DEMO_PORT}/privacy`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // The example household only: whatever this machine has set, nothing real is linked.
      env: { ...NOTHING_REAL, NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" },
    },
    ...(accountsEnv
      ? [
          {
            command: `pnpm exec next start --port ${ACCOUNTS_PORT}`,
            url: `http://localhost:${ACCOUNTS_PORT}/privacy`,
            // Never a server left running here: only one started by this run carries this run's settings.
            reuseExistingServer: false,
            timeout: 60_000,
            env: accountsEnv,
          },
        ]
      : []),
  ],
});
