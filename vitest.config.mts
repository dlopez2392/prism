import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The Plaid and Coinbase adapters, the token vault and accounts (Supabase)
    // read their configuration from the environment. Pin it OFF for the unit
    // suite so real keys can never change what a test asserts: a developer's
    // sandbox keys, and production's own settings when Vercel runs these tests
    // inside its build (vercel.json). Tests that need a value set it with
    // vi.stubEnv. src/lib/env-pins.test.ts fails if the app reads a variable
    // this list doesn't pin.
    env: {
      PLAID_CLIENT_ID: "",
      PLAID_SECRET: "",
      PLAID_ENV: "",
      PLAID_API_URL: "",
      PLAID_WEBHOOK_URL: "",
      PLAID_REDIRECT_URI: "",
      PLAID_LIABILITIES: "",
      RENTCAST_API_KEY: "",
      RENTCAST_API_URL: "",
      ALCHEMY_API_KEY: "",
      PRISM_VAULT_KEY: "",
      COINBASE_CLIENT_ID: "",
      COINBASE_CLIENT_SECRET: "",
      COINBASE_REDIRECT_URI: "",
      COINBASE_LOGIN_URL: "",
      COINBASE_API_URL: "",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      RESEND_API_KEY: "",
      CRON_SECRET: "",
      ALERTS_FROM: "",
      ALERTS_SITE_URL: "",
      // Vercel's preview builds run this suite with VERCEL_ENV=preview.
      VERCEL_ENV: "",
      // Replacement vault keys are read by pattern (vaultKey() in src/lib/server/vault.ts),
      // so pin whichever numbers this environment has: PRISM_VAULT_KEY_2, _3 …
      ...Object.fromEntries(
        Object.keys(process.env)
          .filter((name) => /^PRISM_VAULT_KEY_\d+$/.test(name))
          .map((name) => [name, ""]),
      ),
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
