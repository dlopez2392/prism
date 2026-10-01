// src/lib/alerts/job.ts
//
// One run of the alert email job: ask the database who is due (alerts_due,
// which answers only to the job's secret), open each snapshot with the vault
// key, work out what's new (plan.ts), send it (send.ts), and record what went
// (alerts_sent), so it goes once. People are taken one at a time and the run
// stops at its deadline; whoever is left is first in line tomorrow, since
// nothing of theirs was recorded as sent.
//
// It logs counts only, never an address, a name or an amount.

import "server-only";
import { createHash } from "node:crypto";
import { validSnapshot } from "@/lib/finance/alert-snapshot";
import { openPacked, type VaultKey } from "@/lib/server/vault";
import { renderEmail } from "./email";
import { emailFor, isAlertChoice, type BankFlag, type Recipient } from "./plan";
import { sendAlertEmail, unsubscribeLinks, type AlertsConfig } from "./send";

/** The few database calls the job makes, all through the anon key and the secret. */
export type JobDb = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

type DueRow = {
  user_id: string;
  email: string;
  time_zone: string | null;
  kinds: unknown;
  amounts: boolean;
  sealed: string | null;
  banks: unknown;
  sent: unknown;
};

export type JobReport = { due: number; sent: number; quiet: number; failed: number; refused: number; unopened: number; later: number; stopped: boolean };

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
  const report: JobReport = { due: rows.length, sent: 0, quiet: 0, failed: 0, refused: 0, unopened: 0, later: 0, stopped: false };

  for (const [i, row] of rows.entries()) {
    if (report.stopped || Date.now() > deadline) {
      report.later = rows.length - i;
      break;
    }
    const { r, unopened } = recipient(row, key);
    if (unopened) report.unopened++;
    const email = emailFor(r, now);
    if (!email) {
      report.quiet++;
      continue;
    }
    const links = unsubscribeLinks(config, r.userId);
    const message = renderEmail(email, { site: config.site, settings: `${config.site}/account#alerts`, unsubscribe: links.page });
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
  }
  return report;
}
