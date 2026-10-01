// src/lib/alerts/send.ts
//
// What the alert email job needs from the environment, the unsubscribe link,
// and the one call to Resend.
//
//   RESEND_API_KEY   a Resend key with sending access only.
//   CRON_SECRET      a long random secret (openssl rand -base64 32). Vercel
//                    Cron sends it to the job; the database answers the job
//                    only with it (it keeps its sha256 in job_keys); and it
//                    signs each person's unsubscribe link.
//   ALERTS_FROM      optional sender, "Name <address>" on a domain Resend has
//                    verified; ALERTS_SITE_URL optional address of the app.
//
// Off unless the first two are set, and always off on a preview, which runs
// unmerged code and never reaches production's data (deployment.ts).

import { createHmac, timingSafeEqual } from "node:crypto";
import { BRAND } from "@/lib/brand";
import { isPreviewDeployment } from "@/lib/deployment";
import type { Env } from "@/lib/plaid/client";
import type { Rendered } from "./email";

export type AlertsConfig = { resendKey: string; secret: string; from: string; site: string };

const DEFAULT_SITE = "https://prism.bis-rgv.com";
const DEFAULT_FROM = `${BRAND.product} <no-reply@bis-rgv.com>`;
/** CRON_SECRET's shortest acceptable length; the database refuses anything shorter too (alert_job_allowed). */
export const MIN_SECRET = 32;

export function alertsConfig(env: Env = process.env): AlertsConfig | null {
  if (isPreviewDeployment(env)) return null;
  const resendKey = env.RESEND_API_KEY?.trim();
  const secret = env.CRON_SECRET?.trim();
  if (!resendKey || !secret || secret.length < MIN_SECRET || secret.length > 200) return null;
  const site = (env.ALERTS_SITE_URL?.trim() || DEFAULT_SITE).replace(/\/+$/, "");
  if (!/^https:\/\/[^/\s]+$/.test(site)) return null;
  const from = env.ALERTS_FROM?.trim() || DEFAULT_FROM;
  if (!/^[^<>\r\n]*<[^<>@\s]+@[^<>@\s]+>$/.test(from)) return null;
  return { resendKey, secret, from, site };
}

/** True when the job's caller holds the secret: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. */
export function cronAllowed(header: string | null, secret: string): boolean {
  const given = Buffer.from(header ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The token in a person's unsubscribe link: proof the link came from an email Prism sent them, and good for nothing else. */
export function unsubscribeToken(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(`prism-alerts-unsubscribe\0${userId}`).digest("base64url");
}

/** The person an unsubscribe link names, if its token is theirs; null otherwise. */
export function unsubscribeFor(userId: unknown, token: unknown, secret: string): string | null {
  if (typeof userId !== "string" || typeof token !== "string" || !UUID.test(userId) || token.length > 64) return null;
  const given = Buffer.from(token);
  const wanted = Buffer.from(unsubscribeToken(userId, secret));
  return given.length === wanted.length && timingSafeEqual(given, wanted) ? userId : null;
}

/** The page a person opens from the link, and the address a mail app posts to for one-click unsubscribe (RFC 8058). */
export function unsubscribeLinks(config: AlertsConfig, userId: string): { page: string; oneClick: string } {
  const q = `u=${userId}&t=${unsubscribeToken(userId, config.secret)}`;
  return { page: `${config.site}/alerts/unsubscribe?${q}`, oneClick: `${config.site}/api/alerts/unsubscribe?${q}` };
}

export type SendResult = "sent" | "refused" | "failed" | "stop";

/**
 * One email through Resend. The idempotency key makes a retried run within
 * 24 hours a no-op at Resend instead of a second copy in someone's inbox.
 * "refused" is Resend saying no to this message (a bad address, say), which
 * a retry won't change; "stop" is Resend refusing the key or the sending
 * domain, which no other message will get past either; "failed" is anything
 * else.
 */
export async function sendAlertEmail(
  config: AlertsConfig,
  to: string,
  message: Rendered,
  oneClick: string,
  idempotencyKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.resendKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        from: config.from,
        to: [to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return "sent";
    if (res.status === 401 || res.status === 403) return "stop";
    return res.status === 400 || res.status === 422 ? "refused" : "failed";
  } catch {
    return "failed";
  }
}
