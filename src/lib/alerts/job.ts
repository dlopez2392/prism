// src/lib/alerts/job.ts
//
// One run of the alert email job: ask the database who is due (alerts_due,
// which answers only to the job's secret) and the language each reads Prism
// in (alerts_languages), open each snapshot with the vault key, check their
// banks again first where they allowed it and the snapshot is old or in
// another language (refresh.ts), work out what's new (plan.ts), send it in
// their language (send.ts), and record what went (alerts_sent), so it goes
// once. The same news then goes to
// each device the person lets Prism notify (push_due, webpush.ts), encrypted
// for that device; one its push service says is gone is forgotten
// (push_forget). People are taken one at a time and the run stops at its
// deadline; whoever is left is first in line tomorrow, since nothing of theirs
// was recorded as sent.
//
// It logs counts only, never an address, a name or an amount.

import "server-only";
import { createHash } from "node:crypto";
import { validSnapshot } from "@/lib/finance/alert-snapshot";
import { isLocale, type Locale } from "@/lib/i18n/locale";
import { translator } from "@/lib/i18n/translator";
import { openJson, openPacked, type VaultKey } from "@/lib/server/vault";
import { renderEmail } from "./email";
import { emailFor, isAlertChoice, phoneAlertFor, type BankFlag, type PhoneAlert, type Recipient } from "./plan";
import { morningCheck } from "./refresh";
import { sendAlertEmail, unsubscribeLinks, type AlertsConfig } from "./send";
import { PUSH_SUBJECT, sendPush, validSubscription, vapidKeys, type VapidKeys } from "./webpush";

/** The few database calls the job makes, all through the anon key and the secret. */
export type JobDb = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

type DueRow = {
  user_id: string;
  email: string;
  time_zone: string | null;
  kinds: unknown;
  amounts: boolean;
  sealed: string | null;
  snapshot_at: string | null;
  banks: unknown;
  sent: unknown;
};

export type JobReport = {
  due: number;
  sent: number;
  quiet: number;
  failed: number;
  refused: number;
  unopened: number;
  /** Morning checks that left a new snapshot, and ones that didn't finish (the last snapshot stood). */
  refreshed: number;
  unrefreshed: number;
  /** Notifications handed to a device's push service; ones that didn't go; devices forgotten as gone. */
  pushed: number;
  pushFailed: number;
  forgotten: number;
  later: number;
  stopped: boolean;
};

type DeviceRow = { user_id: string; id: string; sealed: string };

/** A snapshot younger than this is today's already (a visit, or a check that ran): no need to read the banks again. */
export const REFRESH_AFTER_MS = 12 * 60 * 60_000;
/** The longest one person's morning check may take; Plaid's own timeout is longer. */
export const REFRESH_LIMIT_MS = 15_000;

const LATE = Symbol("late");

/** A morning check, or LATE if it doesn't finish in time (it may still land; the email goes from what's known). */
function withinLimit<T>(work: Promise<T>, ms: number): Promise<T | typeof LATE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof LATE>((resolve) => {
    timer = setTimeout(() => resolve(LATE), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

const ATTENTION = new Set(["sign-in", "disconnecting", "revoked"]);
const time = (x: unknown): string | null => (typeof x === "string" && Number.isFinite(Date.parse(x)) ? x : null);

function banksOf(x: unknown): BankFlag[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((b: Record<string, unknown> | null) =>
    b && typeof b.id === "string" && typeof b.name === "string" && ATTENTION.has(b.attention as string)
      ? [{ id: b.id, name: b.name.slice(0, 120), attention: b.attention as BankFlag["attention"], since: time(b.since), disconnectAt: time(b.disconnect_at) }]
      : [],
  );
}

/**
 * The language each person reads Prism in, listed once a run. Anyone the
 * database doesn't name, or every one when it won't say, is written to in
 * English: an alert in the wrong language still beats no alert.
 */
async function languagesOf(db: JobDb, config: AlertsConfig): Promise<Map<string, Locale>> {
  const byPerson = new Map<string, Locale>();
  const { data, error } = await db.rpc("alerts_languages", { p_secret: config.secret });
  if (error || !Array.isArray(data)) {
    if (error) console.error("Prism: the alert job couldn't read which language each person reads Prism in; emails go in English.");
    return byPerson;
  }
  for (const row of data as { user_id?: unknown; language?: unknown }[]) {
    if (typeof row?.user_id === "string" && isLocale(row.language)) byPerson.set(row.user_id, row.language);
  }
  return byPerson;
}

/** Everyone's devices, listed once a run, on its first sent email; none when the database won't say. */
async function devicesOf(db: JobDb, config: AlertsConfig): Promise<Map<string, DeviceRow[]>> {
  const byPerson = new Map<string, DeviceRow[]>();
  const { data, error } = await db.rpc("push_due", { p_secret: config.secret });
  if (error || !Array.isArray(data)) {
    console.error("Prism: the alert job couldn't list the devices to notify; emails still go.");
    return byPerson;
  }
  for (const d of data as DeviceRow[]) {
    if (typeof d?.user_id !== "string" || typeof d.id !== "string" || typeof d.sealed !== "string") continue;
    byPerson.set(d.user_id, [...(byPerson.get(d.user_id) ?? []), d]);
  }
  return byPerson;
}

/**
 * The email's news on each of one person's devices, at once. A device is
 * forgotten when no key in the ring opens it, when it subscribed to a VAPID
 * key that has since been replaced (no push service would take it), or when
 * its push service says it's gone.
 */
async function notify(db: JobDb, config: AlertsConfig, key: VaultKey, vapid: VapidKeys, devices: DeviceRow[], alert: PhoneAlert, report: JobReport, fetchImpl: typeof fetch) {
  await Promise.all(
    devices.map(async (d) => {
      const opened = openJson(d.sealed, key) as { vapid?: unknown } | null;
      const sub = validSubscription(opened);
      const current = opened?.vapid === undefined || opened.vapid === vapid.publicKey;
      const result = sub && current ? await sendPush(sub, alert, vapid, PUSH_SUBJECT, fetchImpl) : "gone";
      if (result === "sent") report.pushed++;
      else if (result === "failed") report.pushFailed++;
      else {
        const forgot = await db.rpc("push_forget", { p_secret: config.secret, p_user_id: d.user_id, p_id: d.id });
        if (!forgot.error) report.forgotten++;
      }
    }),
  );
}

function recipient(row: DueRow, key: VaultKey): { r: Recipient; unopened: boolean } {
  const snapshot = row.sealed ? validSnapshot(openPacked(row.sealed, key)) : null;
  return {
    r: {
      userId: row.user_id,
      email: row.email,
      timeZone: row.time_zone,
      kinds: Array.isArray(row.kinds) ? row.kinds.filter(isAlertChoice) : [],
      amounts: row.amounts !== false,
      snapshot,
      banks: banksOf(row.banks),
      sent: new Set(Array.isArray(row.sent) ? row.sent.filter((f): f is string => typeof f === "string") : []),
    },
    unopened: row.sealed !== null && snapshot === null,
  };
}

export async function runAlertJob(
  db: JobDb,
  config: AlertsConfig,
  key: VaultKey,
  { now = new Date(), deadline = Date.now() + 45_000, fetchImpl = fetch }: { now?: Date; deadline?: number; fetchImpl?: typeof fetch } = {},
): Promise<JobReport> {
  const { data, error } = await db.rpc("alerts_due", { p_secret: config.secret });
  if (error || !Array.isArray(data)) throw new Error("The database didn't say who is due an alert email.");
  const rows = data as DueRow[];
  const report: JobReport = {
    due: rows.length,
    sent: 0,
    quiet: 0,
    failed: 0,
    refused: 0,
    unopened: 0,
    refreshed: 0,
    unrefreshed: 0,
    pushed: 0,
    pushFailed: 0,
    forgotten: 0,
    later: 0,
    stopped: false,
  };
  const languages = await languagesOf(db, config);
  // Asked for only once there's news to send, so a quiet morning makes no extra call.
  let devices: Map<string, DeviceRow[]> | null = null;
  let vapid: VapidKeys | null = null;

  for (const [i, row] of rows.entries()) {
    if (report.stopped || Date.now() > deadline) {
      report.later = rows.length - i;
      break;
    }
    const { r, unopened } = recipient(row, key);
    if (unopened) report.unopened++;
    const t = translator(languages.get(r.userId) ?? "en");
    const old = !row.snapshot_at || now.getTime() - Date.parse(row.snapshot_at) > REFRESH_AFTER_MS;
    // A snapshot whose bills and prices are worded in a language they've since left: a check words them again.
    // Without one, they go as worded, since a warning in the other language beats none.
    const reworded = r.snapshot !== null && r.snapshot.lang !== t.locale;
    // Only with time to finish it and still send: a check that can't fit waits for tomorrow. Whether
    // their banks may be read at all is the database's call: alerts_sources hands over nothing otherwise.
    if ((old || unopened || reworded) && Date.now() + REFRESH_LIMIT_MS < deadline) {
      try {
        const fresh = await withinLimit(morningCheck(db, config, key, r.userId, now, t), REFRESH_LIMIT_MS);
        if (fresh === LATE) report.unrefreshed++;
        else if (fresh) {
          r.snapshot = fresh;
          report.refreshed++;
        }
      } catch {
        report.unrefreshed++;
      }
    }
    const email = emailFor(r, now, t);
    if (!email) {
      report.quiet++;
      continue;
    }
    const links = unsubscribeLinks(config, r.userId);
    const message = renderEmail(email, { site: config.site, settings: `${config.site}/account#alerts`, unsubscribe: links.page }, t);
    // The same news to the same person is the same request, so a retried run within a day sends nothing twice.
    const idempotency = `prism-alerts-${createHash("sha256").update(`${r.userId}\0${email.fingerprints.join(",")}`).digest("hex")}`;
    const result = await sendAlertEmail(config, r.email, message, links.oneClick, idempotency, fetchImpl);
    if (result === "stop") {
      report.stopped = true;
      report.failed++;
      continue;
    }
    if (result !== "sent") {
      report[result]++;
      continue;
    }
    report.sent++;
    const recorded = await db.rpc("alerts_sent", { p_secret: config.secret, p_user_id: r.userId, p_fingerprints: email.fingerprints });
    // Sent but not recorded: Resend's idempotency covers a retry today; tomorrow it would go again.
    if (recorded.error) console.error("Prism: an alert email went out but wasn't recorded as sent.");
    devices ??= await devicesOf(db, config);
    const theirs = devices.get(r.userId);
    if (theirs?.length) {
      vapid ??= vapidKeys(config.secret);
      await notify(db, config, key, vapid, theirs, phoneAlertFor(email, t), report, fetchImpl);
    }
  }
  return report;
}
