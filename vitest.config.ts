import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The Plaid adapter and the token vault read their configuration from the
    // environment. Pin it OFF for the unit suite so a developer's real sandbox
    // keys can never change what a test asserts; tests that need a value set it
    // with vi.stubEnv.
    env: { PLAID_CLIENT_ID: "", PLAID_SECRET: "", PLAID_ENV: "", PRISM_VAULT_KEY: "" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
