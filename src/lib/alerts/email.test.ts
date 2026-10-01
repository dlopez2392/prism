// An alert email as it leaves (email.ts): the same words as text and as HTML,
// everything from a person's data escaped, no image or tracker, every link
// straight to Prism, and colours that are the light theme's own tokens.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMAIL_COLORS, renderEmail } from "./email";
import type { Email } from "./plan";

const links = { site: "https://prism.example", settings: "https://prism.example/account#alerts", unsubscribe: "https://prism.example/alerts/unsubscribe?u=1&t=2" };
const email: Email = {
  subject: "Tom & Jerry's <Diner> may not be covered on Thu, Oct 8",
  items: [{ title: "Tom & Jerry's <Diner> may not be covered on Thu, Oct 8", detail: `It's due before payday. <script>alert("x")</script>`, href: "/future", urgent: true }],
  summary: { title: "Your week", lines: [{ label: "Spent", value: "$840 from Sep 27 to Oct 3, $40 more than the week before" }], note: null },
  asOf: { day: "2026-10-04", by: "visit" },
  fingerprints: [],
};

describe("an alert email, written out", () => {
  const out = renderEmail(email, links);

  it("says the same in text and HTML: each alert, the summary, when the figures are from, and how to stop them", () => {
    for (const part of ["may not be covered on Thu, Oct 8", "$840 from Sep 27 to Oct 3", "on Sun, Oct 4", links.unsubscribe, `${links.site}/future`]) {
      expect(out.text).toContain(part);
    }
    expect(out.html).toContain("may not be covered on Thu, Oct 8");
    expect(out.html).toContain("on Sun, Oct 4");
    expect(out.html).toContain(`href="${links.unsubscribe.replace(/&/g, "&amp;")}"`);
    expect(out.subject).toBe(email.subject);
  });

  it("escapes everything that came from someone's data, so a merchant's name can't become markup", () => {
    expect(out.html).not.toMatch(/<script|<Diner>/);
    expect(out.html).toContain("Tom &amp; Jerry&#39;s &lt;Diner&gt;");
  });

  it("has no images, no tracking, and links only to Prism", () => {
    expect(out.html).not.toMatch(/<img|url\(|<link|<script/i);
    const hrefs = [...out.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(2);
    for (const h of hrefs) expect(h.startsWith(links.site)).toBe(true);
  });

  it("claims no 'as of' when nothing in it came from a visit", () => {
    const fresh = renderEmail({ ...email, asOf: null, summary: null }, links);
    expect(fresh.text).not.toMatch(/as of your visit/);
  });

  it("paints with the light theme's own tokens, since email clients can't read them", () => {
    const css = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");
    const light = css.slice(0, css.indexOf("@media"));
    const token = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(light)?.[1]?.toLowerCase();
    expect(EMAIL_COLORS).toEqual({ ink: token("ink-1"), muted: token("ink-3"), accent: token("accent"), page: token("surface-0"), card: token("surface-1"), crit: token("crit") });
  });
});
