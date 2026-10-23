// src/lib/alerts/notice-job.ts
//
// The change notice's email (legal-notice.ts): one message to every account,
// in the language each reads Prism in, about a change before it takes
// effect. It goes only once the operator names the notice in NOTICE_EMAIL,
// and only before the change's day: a notice that arrives after the change
// isn't one. The daily job (api/cron/alerts) runs it first, for a few
// seconds; whoever it doesn't reach is first in line tomorrow, since only a
// message that went is recorded (notice_sent).
//
// Plain words, no images, no tracked links, no unsubscribe link: it isn't
// marketing, and it goes once. It logs counts only, never an address.

import "server-only";
import { createHash } from "node:crypto";
import { BRAND } from "@/lib/brand";
import { isPreviewDeployment } from "@/lib/deployment";
import { isLocale } from "@/lib/i18n/locale";
import { EN, type T } from "@/lib/i18n/t";
import { translator } from "@/lib/i18n/translator";
import { fullDate, noticeById, noticeWords, type ChangeNotice } from "@/lib/legal-notice";
import type { Env } from "@/lib/plaid/client";
import { EMAIL_COLORS, type Rendered } from "./email";
import type { JobDb } from "./job";
import { sendAlertEmail, type AlertsConfig } from "./send";

export type NoticeReport = { notice: string; due: number; sent: number; refused: number; failed: number; later: number; stopped: boolean } | { notice: string; skipped: "late" };

/** The notice the operator switched the email on for (NOTICE_EMAIL), or null. Never on a preview. */
export function noticeToSend(env: Env = process.env): ChangeNotice | null {
  if (isPreviewDeployment(env)) return null;
  return noticeById(env.NOTICE_EMAIL?.trim());
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function renderNoticeEmail(n: ChangeNotice, site: string, t: T = EN): Rendered {
  const C = EMAIL_COLORS;
  const product = BRAND.product;
  const { title, points } = noticeWords(n, t);
  const intro = t("We're changing {product}'s terms on {date}. Here is what changes for you.", { product, date: fullDate(n.effective, t.locale) });
  const links = [
    { label: t("Read the Terms of Service"), href: `${site}/terms` },
    { label: t("See what each plan includes"), href: `${site}/pricing` },
  ];
  const why = t("You're getting this because you have a {product} account. We write about a change like this once, before it takes effect.", { product });
  const questions = t("Questions? Write to {email}.", { email: BRAND.privacyEmail });

  const text = [intro, "", ...points.map((p) => `- ${p}`), "", ...links.map((l) => `${l.label}: ${l.href}`), "", "—", why, questions].join("\n");

  const p = (body: string, style = "") => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:${C.ink};${style}">${body}</p>`;
  const a = (href: string, label: string) => `<a href="${escape(href)}" style="color:${C.accent};font-weight:600;text-decoration:underline">${escape(label)}</a>`;
  const html = [
    `<!doctype html><html lang="${t.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head>`,
    `<body style="margin:0;padding:24px 16px;background:${C.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`,
    `<div style="max-width:560px;margin:0 auto;background:${C.card};border-radius:20px;padding:24px">`,
    p(`<strong style="color:${C.accent}">${escape(product)}</strong>`, "font-size:13px;letter-spacing:.04em"),
    p(`<strong>${escape(title)}</strong>`, "font-size:18px"),
    p(escape(intro)),
    `<ul style="margin:0 0 16px;padding-left:20px">`,
    ...points.map((x) => `<li style="margin:0 0 8px;font-size:15px;line-height:1.5;color:${C.ink}">${escape(x)}</li>`),
    `</ul>`,
    p(links.map((l) => a(l.href, l.label)).join(" &nbsp;·&nbsp; ")),
    `<div style="padding-top:16px;border-top:1px solid ${C.page}">`,
    p(escape(why), `font-size:12px;color:${C.muted}`),
    p(escape(questions), `font-size:12px;color:${C.muted}`),
    `</div></div></body></html>`,
  ].join("");
  return { subject: title, text, html };
}

type DueRow = { user_id: string; email: string; language: string };

/** The same person and notice always make the same key, so a retried run within a day sends nothing twice. */
const idempotencyKey = (notice: string, userId: string) => createHash("sha256").update(`prism-notice\0${notice}\0${userId}`).digest("hex");

export async function runNoticeJob(
  db: JobDb,
  config: AlertsConfig,
  n: ChangeNotice,
  { now = new Date(), deadline = Date.now() + 15_000, fetchImpl = fetch }: { now?: Date; deadline?: number; fetchImpl?: typeof fetch } = {},
): Promise<NoticeReport> {
  if (now.toISOString().slice(0, 10) >= n.effective) return { notice: n.id, skipped: "late" };
  const { data, error } = await db.rpc("notice_due", { p_secret: config.secret, p_notice: n.id });
  if (error || !Array.isArray(data)) throw new Error("The database didn't say who the notice hasn't reached.");
  const due = (data as DueRow[]).filter((r) => typeof r?.user_id === "string" && typeof r.email === "string");
  const report = { notice: n.id, due: due.length, sent: 0, refused: 0, failed: 0, later: 0, stopped: false };
  const rendered = new Map<string, Rendered>();
  for (const [i, row] of due.entries()) {
    if (Date.now() >= deadline) {
      report.later = due.length - i;
      break;
    }
    const locale = isLocale(row.language) ? row.language : "en";
    const message = rendered.get(locale) ?? renderNoticeEmail(n, config.site, translator(locale));
    rendered.set(locale, message);
    const result = await sendAlertEmail(config, row.email, message, null, idempotencyKey(n.id, row.user_id), fetchImpl);
    if (result === "stop") {
      report.stopped = true;
      report.later = due.length - i;
      break;
    }
    if (result === "failed") {
      report.failed++;
      continue;
    }
    // A refused address won't take it tomorrow either: recorded, so it isn't tried every day.
    if (result === "sent") report.sent++;
    else report.refused++;
    const recorded = await db.rpc("notice_sent", { p_secret: config.secret, p_user_id: row.user_id, p_notice: n.id });
    if (recorded.error) console.error("Prism: a change notice went but wasn't recorded; Resend's idempotency covers a retry today.");
  }
  return report;
}
