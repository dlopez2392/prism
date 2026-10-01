// src/lib/alerts/plan.ts
//
// What one person's alert email says today, if anything: the daily job
// (src/app/api/cron/alerts) asks this once per person who turned emails on.
//
//   - A bank needing a sign-in, or about to stop updating, comes straight from
//     the database (Plaid's webhook keeps it there), so it's never older than
//     the warning itself.
//   - A bill the account won't cover, and a price that went up, come from the
//     snapshot their last visit left (alert-snapshot.ts), and only while that
//     visit is recent: a week-old forecast is not news.
//   - On their own Monday, a short summary of the week, from the same
//     snapshot. A quiet or stale week still sends, saying so, because silence
//     can't be told apart from a broken job.
//
// Each piece is sent once: its fingerprint (sha256 of the person and the
// alert's occasion) is recorded after sending, and anything already recorded
// is left out. With amounts off, every line uses its wording without dollars.

import { createHash } from "node:crypto";
import { BRAND } from "@/lib/brand";
import type { Alert } from "@/lib/finance/alerts";
import type { AlertSnapshot } from "@/lib/finance/alert-snapshot";
import { addDays, dayOfWeek, daysBetween } from "@/lib/finance/dates";
import { dayDate, money0, percent, shortDate } from "@/lib/finance/format";
import type { Cents, ISODate } from "@/lib/finance/types";

export { ALERT_CHOICES, isAlertChoice, type AlertChoice } from "./choices";
import type { AlertChoice } from "./choices";

/** A bank Plaid has warned about (plaid_items.attention), as alerts_due returns it. */
export type BankFlag = { id: string; name: string; attention: "sign-in" | "disconnecting" | "revoked"; since: string | null; disconnectAt: string | null };

/** One person, as the job reads them: their choices, their last visit's snapshot (opened), and what was already sent. */
export type Recipient = {
  userId: string;
  email: string;
  timeZone: string | null;
  kinds: AlertChoice[];
  amounts: boolean;
  snapshot: AlertSnapshot | null;
  banks: BankFlag[];
  /** Fingerprints already sent to them. */
  sent: ReadonlySet<string>;
};

export type EmailItem = { title: string; detail: string; href: string; urgent: boolean };
export type SummaryLine = { label: string; value: string };
export type Summary = { title: string; lines: SummaryLine[]; note: string | null };

export type Email = {
  subject: string;
  items: EmailItem[];
  summary: Summary | null;
  /** When, and by whom, the snapshot behind its figures was taken, when any figure came from one. */
  asOf: { day: ISODate; by: AlertSnapshot["by"] } | null;
  /** To record once it's sent. */
  fingerprints: string[];
};

/** A snapshot older than this says nothing about bills or prices; the weekly summary says when it was taken instead. */
export const SNAPSHOT_FRESH_DAYS = 8;
/** A short bill is sent from this many days before it's due. */
const BILL_LEAD_DAYS = 7;
/** At most this many alerts in one email (alerts_sent records up to 50). */
const MAX_ITEMS = 20;
const SUBJECT_MAX = 120;

export function fingerprint(userId: string, alertId: string): string {
  return createHash("sha256").update(`${userId}:${alertId}`).digest("hex");
}

/** The date in a time zone (the person's, as their browser last reported it); UTC when it's missing or unknown. */
export function localDay(zone: string | null, now: Date): ISODate {
  try {
    if (zone) {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
    }
  } catch {
    // An unknown zone name falls through to UTC.
  }
  return now.toISOString().slice(0, 10);
}

const isoDay = (t: string): ISODate => t.slice(0, 10) as ISODate;
/** An alert's occasion, its words, and whether a snapshot's figures are behind it. */
type Candidate = { id: string; item: EmailItem; fromSnapshot: boolean };
const SIGN_IN = "Sign in again on Connections and it carries on where it left off.";

function bankItems(r: Recipient, now: Date): Candidate[] {
  const out: Candidate[] = [];
  for (const b of r.banks) {
    if (b.attention === "disconnecting") {
      // Past its date it has already stopped: the sign-in Plaid asks for next is its own alert.
      if (!b.disconnectAt || !(Date.parse(b.disconnectAt) > now.getTime())) continue;
      const on = isoDay(b.disconnectAt);
      out.push({
        id: `bank:${b.id}:disconnect:${on}`,
        item: { title: `${b.name} stops updating on ${dayDate(on)}`, detail: "Unless you sign in again before then. It takes a minute on Connections, and nothing is lost.", href: "/connections", urgent: true },
        fromSnapshot: false,
      });
    } else {
      // Dated by when Plaid said so, so the same bank needing it again next month is news again.
      out.push({
        id: `bank:${b.id}:${b.attention}:${b.since ? isoDay(b.since) : "undated"}`,
        item: { title: `${b.name} needs you to sign in again`, detail: `Until you do, ${BRAND.product} can't see anything new from it. ${SIGN_IN}`, href: "/connections", urgent: true },
        fromSnapshot: false,
      });
    }
  }
  return out;
}

function snapshotItems(r: Recipient, snap: AlertSnapshot, today: ISODate): Candidate[] {
  return snap.alerts
    .filter((a) => {
      if (a.kind === "bill-short") return r.kinds.includes("bill-short") && a.on !== null && a.on >= today && daysBetween(today, a.on) <= BILL_LEAD_DAYS;
      if (a.kind === "price-rise") return r.kinds.includes("price-rise");
      return false;
    })
    .map((a: Alert) => {
      const words = r.amounts ? a : a.quiet;
      return { id: a.id, item: { title: words.title, detail: words.detail, href: a.href, urgent: a.urgent }, fromSnapshot: true };
    });
}

/** "$40 more than the week before", "less than the week before": a change in words, never an arrow. */
function compared(now: Cents, before: Cents, amounts: boolean, more: string, less: string, same: string): string {
  const d = now - before;
  if (Math.abs(d) < 100) return same;
  if (!amounts) return d > 0 ? more : less;
  return `${money0(Math.abs(d))} ${d > 0 ? more : less}`;
}

function summaryOf(r: Recipient, snap: AlertSnapshot | null, today: ISODate, fresh: boolean): Summary {
  const title = "Your week";
  if (!snap || !fresh) {
    const seen = snap ? `since ${dayDate(snap.today)}` : "lately";
    return { title, lines: [], note: `${BRAND.product} hasn't looked at your accounts ${seen}, so there are no new figures this week. Open ${BRAND.product} and next Monday's summary will have them.` };
  }
  const w = snap.weekly;
  const lines: SummaryLine[] = [];
  const spentWords = compared(w.spent, w.spentBefore, r.amounts, "more than the week before", "less than the week before", "about the same as the week before");
  lines.push({
    label: "Spent",
    value: r.amounts ? `${money0(w.spent)} from ${shortDate(w.from)} to ${shortDate(w.to)}, ${spentWords}` : `${spentWords.charAt(0).toUpperCase()}${spentWords.slice(1)}, ${shortDate(w.from)} to ${shortDate(w.to)}`,
  });
  if (w.month && w.month.limit > 0) {
    lines.push({
      label: "Budgets",
      value: r.amounts ? `${money0(w.month.spent)} of ${money0(w.month.limit)} used so far this month` : `${percent(w.month.spent / w.month.limit)} used so far this month`,
    });
  }
  if (w.netWorthLastMonth !== null) {
    const change = compared(w.netWorth, w.netWorthLastMonth, r.amounts, "up since the end of last month", "down since the end of last month", "level with the end of last month");
    lines.push({ label: "Net worth", value: r.amounts ? `${money0(w.netWorth)}, ${change}` : `${change.charAt(0).toUpperCase()}${change.slice(1)}` });
  }
  if (snap.upcoming !== null) {
    const soon = snap.upcoming.filter((u) => u.date >= today && u.date <= addDays(today, BILL_LEAD_DAYS));
    lines.push({
      label: "Coming up",
      value: soon.length
        ? soon
            .slice(0, 6)
            .map((u) => (r.amounts ? `${u.name} ${money0(u.amount)} on ${dayDate(u.date)}` : `${u.name} on ${dayDate(u.date)}`))
            .join("; ") + (soon.length > 6 ? `; and ${soon.length - 6} more` : "")
        : `Nothing ${BRAND.product} knows of is due in the next seven days.`,
    });
  }
  return { title, lines, note: null };
}

function clip(s: string): string {
  return s.length <= SUBJECT_MAX ? s : `${s.slice(0, SUBJECT_MAX - 1).trimEnd()}…`;
}

/** Today's email for this person, or null when there's nothing new to send. */
export function emailFor(r: Recipient, now: Date): Email | null {
  const today = localDay(r.timeZone, now);
  const snap = r.snapshot;
  // A snapshot from "tomorrow" (a visit from a zone ahead of the stored one) counts as fresh.
  const fresh = snap !== null && daysBetween(snap.today, today) <= SNAPSHOT_FRESH_DAYS;
  const candidates = [...(r.kinds.includes("bank") ? bankItems(r, now) : []), ...(snap && fresh ? snapshotItems(r, snap, today) : [])];

  const prints: string[] = [];
  const chosen: Candidate[] = [];
  for (const c of candidates) {
    const f = fingerprint(r.userId, c.id);
    if (r.sent.has(f) || prints.includes(f) || chosen.length >= MAX_ITEMS) continue;
    prints.push(f);
    chosen.push(c);
  }
  const items = chosen.map((c) => c.item).sort((x, y) => Number(y.urgent) - Number(x.urgent));

  let summary: Summary | null = null;
  if (r.kinds.includes("weekly") && dayOfWeek(today) === 1) {
    const f = fingerprint(r.userId, `weekly:${today}`);
    if (!r.sent.has(f)) {
      summary = summaryOf(r, snap, today, fresh);
      prints.push(f);
    }
  }
  if (items.length === 0 && !summary) return null;

  const [first] = items;
  const subject = first ? clip(items.length > 1 ? `${first.title}, and ${items.length - 1} more` : first.title) : `Your week in ${BRAND.product}`;
  const fromSnapshot = chosen.some((c) => c.fromSnapshot) || (summary !== null && summary.note === null);
  return { subject, items, summary, asOf: fromSnapshot && snap ? { day: snap.today, by: snap.by } : null, fingerprints: prints };
}
