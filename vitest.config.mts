import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The Plaid and Coinbase adapters and the token vault read their configuration from the
    // environment. Pin it OFF for the unit suite so a developer's real sandbox
    // keys can never change what a test asserts; tests that need a value set it
    // with vi.stubEnv.
    env: {
      PLAID_CLIENT_ID: "",
      PLAID_SECRET: "",
      PLAID_ENV: "",
      PRISM_VAULT_KEY: "",
      COINBASE_CLIENT_ID: "",
      COINBASE_CLIENT_SECRET: "",
      COINBASE_REDIRECT_URI: "",
      COINBASE_LOGIN_URL: "",
      COINBASE_API_URL: "",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
