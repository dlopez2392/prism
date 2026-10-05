// The privacy policy promised Prism "doesn't read [loan details] yet, and this
// page will say so before it does". Reading them is one switch
// (PLAID_LIABILITIES), and the policy's words follow that same switch.

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

async function policy(): Promise<string> {
  vi.resetModules();
  const { default: PrivacyPage } = await import("@/app/privacy/page");
  return renderToStaticMarkup(await PrivacyPage()).replace(/&#x27;|&apos;/g, "'");
}

describe("the privacy policy on loan details", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("says Prism doesn't read them while reading them is off", async () => {
    const text = await policy();
    expect(text).toContain("doesn't read them yet, and this page will say so before it does");
    expect(text).not.toContain("also reads loan details");
  });

  it("says it reads them, what for, and that the household doesn't see them, once switched on", async () => {
    vi.stubEnv("PLAID_LIABILITIES", "on");
    const text = await policy();
    expect(text).toContain("also reads loan details");
    expect(text).toContain("aren't shown to your household");
    expect(text).not.toContain("doesn't read them yet");
  });
});
