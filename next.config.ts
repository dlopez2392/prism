import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Plaid Link is loaded from cdn.plaid.com at click time (lib/plaid/link.ts);
  // nothing else in this app talks to a third-party origin from the browser.
  poweredByHeader: false,
};

export default nextConfig;
