import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Plaid Link is loaded from cdn.plaid.com at click time (lib/plaid/link.ts);
  // nothing else in this app talks to a third-party origin from the browser.
  poweredByHeader: false,
  // No other site may frame Prism: a framed consent screen ("Allow Claude?")
  // or Delete account is how clickjacking tricks a click. Plaid Link is a
  // frame INSIDE Prism, which this doesn't touch.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      // The notification service worker (public/sw.js): always fetched fresh, so a fix reaches every
      // device on its next visit, and allowed to load nothing from anywhere but Prism.
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
