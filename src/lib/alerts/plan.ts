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
//   - Early each month, the month before in a few lines (the same "weekly"
//     choice, shown as Summaries): the first morning a snapshot taken this
//     month has it, or on the 7th, saying why it can't. It takes the place of
//     a Monday summary that falls on the same day.
//
// Each piece is sent once: its fingerprint (sha256 of the person and the
// alert's occasion) is recorded after sending, and anything already recorded
// is left out. With amounts off, every line uses its wording without dollars.

import { createHash } from "node:crypto";
import { BRAND } from "@/lib/brand";
import type { Alert } from "@/lib/finance/alerts";
import type { AlertSnapshot } from "@/lib/finance/alert-snapshot";
import { addDays, addMonths, dayOfMonth, dayOfWeek, daysBetween, monthKey, startOfMonth } from "@/lib/finance/dates";
import { dayDate, money0, monthLong, percent, shortDate } from "@/lib/finance/format";
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
/** The recap of last month waits this many days at most for a snapshot that has it. */
export const RECAP_LAST_DAY = 7;
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

const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
 * Last month, in a few lines, early in this one: once a snapshot taken this
 * month has it, or on the 7th saying why it can't. Null while it waits, and
 * for a month Prism didn't hold whole (nothing to sum up, nothing wrong).
 */
function recapOf(r: Recipient, snap: AlertSnapshot | null, today: ISODate): { id: string; summary: Summary } | null {
  if (dayOfMonth(today) > RECAP_LAST_DAY) return null;
  const thisMonth = startOfMonth(today);
  const month = monthKey(addMonths(thisMonth, -1));
  const name = monthLong(`${month}-01`);
  const id = `monthly:${month}`;
  const title = `Your ${name}`;
  const seenThisMonth = snap !== null && snap.today >= thisMonth;
  const m = seenThisMonth ? snap.monthly : null;
  if (!m || m.month !== month) {
    if (seenThisMonth || dayOfMonth(today) < RECAP_LAST_DAY) return null;
    const seen = snap ? `since ${dayDate(snap.today)}` : "lately";
    return { id, summary: { title, lines: [], note: `${BRAND.product} hasn't looked at your accounts ${seen}, so it can't sum up ${name} here. Open ${BRAND.product} to see it on Cash flow.` } };
  }
  const lines: SummaryLine[] = [];
  const kept = m.income - m.spent;
  lines.push({
    label: "In and out",
    value: r.amounts
      ? `${money0(m.income)} came in and ${money0(m.spent)} went out, so you ${kept >= 0 ? `kept ${money0(kept)}` : `spent ${money0(-kept)} more than came in`}`
      : kept >= 0
        ? "You kept some of what came in"
        : "You spent more than came in",
  });
  if (m.before) {
    const prev = monthLong(`${monthKey(addMonths(`${month}-01`, -1))}-01`);
    const spent = compared(m.spent, m.before.spent, r.amounts, `more spent than in ${prev}`, `less spent than in ${prev}`, `about the same spent as in ${prev}`);
    lines.push({ label: `Against ${prev}`, value: cap(spent) });
  }
  if (m.top.length) {
    lines.push({ label: "Where it went", value: r.amounts ? m.top.map((t) => `${t.label} ${money0(t.spent)}`).join(", ") : list(m.top.map((t) => t.label)) });
  }
  if (m.netWorth) {
    const c = m.netWorth.change;
    const way = Math.abs(c) < 100 ? "about level" : c > 0 ? "up" : "down";
    const moved = way === "about level" || !r.amounts ? `${way} over the month` : `${way} ${money0(Math.abs(c))} over the month`;
    lines.push({ label: "Net worth", value: r.amounts ? `${money0(m.netWorth.end)} at the end of ${name}, ${moved}` : cap(moved) });
  }
  if (m.ahead) {
    const bills = `${m.ahead.count} ${m.ahead.count === 1 ? "bill" : "bills"} in the next 30 days`;
    lines.push({
      label: "Coming up",
      value: m.ahead.count === 0 ? `Nothing ${BRAND.product} knows of is due in the next 30 days.` : r.amounts ? `${bills}, about ${money0(m.ahead.total)} in all` : cap(bills),
    });
  }
  return { id, summary: { title, lines, note: null } };
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
  if (r.kinds.includes("weekly")) {
    const recap = recapOf(r, snap, today);
    const f = recap ? fingerprint(r.userId, recap.id) : null;
    if (recap && f && !r.sent.has(f)) {
      summary = recap.summary;
      prints.push(f);
    }
  }
  if (!summary && r.kinds.includes("weekly") && dayOfWeek(today) === 1) {
    const f = fingerprint(r.userId, `weekly:${today}`);
    if (!r.sent.has(f)) {
      summary = summaryOf(r, snap, today, fresh);
      prints.push(f);
    }
  }
  if (items.length === 0 && !summary) return null;

  const [first] = items;
  const subject = first ? clip(items.length > 1 ? `${first.title}, and ${items.length - 1} more` : first.title) : `${summary!.title} in ${BRAND.product}`;
  const fromSnapshot = chosen.some((c) => c.fromSnapshot) || (summary !== null && summary.note === null);
  return { subject, items, summary, asOf: fromSnapshot && snap ? { day: snap.today, by: snap.by } : null, fingerprints: prints };
}

/** What a phone shows with the email: a title, a line, and where tapping it goes. */
export type PhoneAlert = { title: string; body: string; url: string };

const BODY_MAX = 240;

/**
 * The email, as one notification for each device the person lets Prism
 * notify. The first (most urgent) item leads, in the same words as the email,
 * so a phone never shows an amount the person turned off; the rest are
 * counted, and they're in the email. Only ever a path on Prism to open.
 */
export function phoneAlertFor(email: Email): PhoneAlert {
  const [first, ...rest] = email.items;
  const fit = (s: string) => (s.length <= BODY_MAX ? s : `${s.slice(0, BODY_MAX - 1).trimEnd()}…`);
  if (first) {
    const more = rest.length + (email.summary ? 1 : 0);
    return { title: clip(first.title), body: fit(more ? `${first.detail} And ${more} more in today's email.` : first.detail), url: first.href };
  }
  const s = email.summary;
  const line = s?.note ?? (s?.lines[0] ? `${s.lines[0].label}: ${s.lines[0].value}` : `Open ${BRAND.product} for this week's figures.`);
  return { title: `${s?.title ?? "Your week"} in ${BRAND.product}`, body: fit(line), url: "/" };
}
