// src/lib/alerts/email.ts
//
// An alert email, written out twice: plain text, and a simple HTML version of
// the same words. No images, no tracking pixel, no tracked links: every link
// goes straight to Prism. Everything that came from a person's data (a bank's
// or a merchant's name) is escaped before it goes into the HTML.
//
// Email clients ignore stylesheets and CSS variables, so the few colours here
// are the light theme's tokens written out (EMAIL_COLORS); alerts.test checks
// them against tokens.css so the two can't drift.

import { BRAND } from "@/lib/brand";
import { dayDate } from "@/lib/finance/format";
import type { Email } from "./plan";

/** tokens.css, light theme: --ink-1, --ink-3, --accent, --surface-0, --surface-1, --crit. */
export const EMAIL_COLORS = { ink: "#15122b", muted: "#6b6785", accent: "#7c3aed", page: "#f4f3fb", card: "#ffffff", crit: "#d03b3b" } as const;

export type Rendered = { subject: string; text: string; html: string };
export type Links = { site: string; settings: string; unsubscribe: string };

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function footerWords(email: Email): string[] {
  return [
    ...(email.asOf
      ? [
          email.asOf.by === "morning"
            ? `Bills, prices and figures are from ${BRAND.product}'s check of your banks on ${dayDate(email.asOf.day)}; a bank's warning is as it reached ${BRAND.product}.`
            : `Bills, prices and figures are as of your visit to ${BRAND.product} on ${dayDate(email.asOf.day)}; a bank's warning is as it reached ${BRAND.product}.`,
        ]
      : []),
    `You asked ${BRAND.product} for these emails. Choose what they cover on your Account page, or stop them with one click.`,
  ];
}

export function renderEmail(email: Email, links: Links): Rendered {
  const C = EMAIL_COLORS;
  const text: string[] = [];
  for (const i of email.items) text.push(i.title, i.detail, `${links.site}${i.href}`, "");
  if (email.summary) {
    text.push(email.summary.title.toUpperCase());
    for (const l of email.summary.lines) text.push(`${l.label}: ${l.value}`);
    if (email.summary.note) text.push(email.summary.note);
    text.push(`${links.site}/`, "");
  }
  text.push("—", ...footerWords(email), `Your Account page: ${links.settings}`, `Stop these emails: ${links.unsubscribe}`);

  const p = (body: string, style = "") => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:${C.ink};${style}">${body}</p>`;
  const a = (href: string, label: string) => `<a href="${escape(href)}" style="color:${C.accent};font-weight:600;text-decoration:underline">${escape(label)}</a>`;
  const parts: string[] = [];
  for (const i of email.items) {
    parts.push(
      `<div style="padding:16px 0;border-top:1px solid ${C.page}">`,
      p(`${i.urgent ? `<span style="color:${C.crit}">&#9679;</span> ` : ""}<strong>${escape(i.title)}</strong>`, "margin-bottom:6px"),
      p(escape(i.detail), `color:${C.muted}`),
      p(a(`${links.site}${i.href}`, i.href === "/connections" ? "Open Connections" : `Open ${BRAND.product}`), "margin:0"),
      `</div>`,
    );
  }
  if (email.summary) {
    const s = email.summary;
    parts.push(`<div style="padding:16px 0;border-top:1px solid ${C.page}">`, p(`<strong>${escape(s.title)}</strong>`));
    if (s.lines.length) {
      parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 12px">`);
      for (const l of s.lines) {
        parts.push(
          `<tr><td style="padding:4px 16px 4px 0;font-size:13px;color:${C.muted};vertical-align:top;white-space:nowrap">${escape(l.label)}</td><td style="padding:4px 0;font-size:15px;color:${C.ink}">${escape(l.value)}</td></tr>`,
        );
      }
      parts.push(`</table>`);
    }
    if (s.note) parts.push(p(escape(s.note)));
    parts.push(p(a(`${links.site}/`, `Open ${BRAND.product}`), "margin:0"), `</div>`);
  }
  const footer = footerWords(email).map((w) => p(escape(w), `font-size:12px;color:${C.muted}`));
  footer.push(p(`${a(links.settings, "Account page")} &nbsp;·&nbsp; ${a(links.unsubscribe, "Stop these emails")}`, "font-size:12px"));

  const html = [
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(email.subject)}</title></head>`,
    `<body style="margin:0;padding:24px 16px;background:${C.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`,
    `<div style="max-width:560px;margin:0 auto;background:${C.card};border-radius:20px;padding:24px">`,
    p(`<strong style="color:${C.accent}">${escape(BRAND.product)}</strong>`, "font-size:13px;letter-spacing:.04em"),
    ...parts,
    `<div style="padding-top:16px;border-top:1px solid ${C.page}">`,
    ...footer,
    `</div></div></body></html>`,
  ].join("");

  return { subject: email.subject, text: text.join("\n"), html };
}
