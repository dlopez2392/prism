// src/app/manifest.ts — what makes Prism installable: added to a phone's Home
// Screen it opens as its own app, without the browser around it, which is
// also what an iPhone requires before it lets a website send notifications.

import type { MetadataRoute } from "next";
import { BRAND, PAGE_COLORS } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: BRAND.product,
    short_name: BRAND.product,
    description: `See where your money goes, what's coming next, and how far you've come. A ${BRAND.company} product.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: PAGE_COLORS.dark,
    theme_color: PAGE_COLORS.dark,
    categories: ["finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
