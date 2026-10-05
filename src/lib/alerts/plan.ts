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
// Every word is in the language of `t`, the one the person reads Prism in
// (profiles.language); a bill or a price comes in the words the snapshot
// already holds, which the job sees are in the same language (job.ts).

import { createHash } from "node:crypto";
import { BRAND } from "@/lib/brand";
import type { Alert } from "@/lib/finance/alerts";
import type { AlertSnapshot } from "@/lib/finance/alert-snapshot";
import { addDays, addMonths, dayOfMonth, dayOfWeek, daysBetween, monthKey, startOfMonth } from "@/lib/finance/dates";
import { dayDate, money0, monthLong, percent, shortDate } from "@/lib/finance/format";
import type { Cents, ISODate } from "@/lib/finance/types";
import { EN, msg, type T } from "@/lib/i18n/t";

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
/** What alerts_due calls a bank Plaid gave no name. */
const UNNAMED_BANK = msg("Your bank");
const product = BRAND.product;

function bankItems(r: Recipient, now: Date, t: T): Candidate[] {
  const out: Candidate[] = [];
  for (const b of r.banks) {
    const bank = b.name === UNNAMED_BANK ? t(UNNAMED_BANK) : b.name;
    if (b.attention === "disconnecting") {
      // Past its date it has already stopped: the sign-in Plaid asks for next is its own alert.
      if (!b.disconnectAt || !(Date.parse(b.disconnectAt) > now.getTime())) continue;
      const on = isoDay(b.disconnectAt);
      out.push({
        id: `bank:${b.id}:disconnect:${on}`,
        item: {
          title: t("{bank} stops updating on {date}", { bank, date: dayDate(on, t.locale) }),
          detail: t("Unless you sign in again before then. It takes a minute on Connections, and nothing is lost."),
          href: "/connections",
          urgent: true,
        },
        fromSnapshot: false,
      });
    } else {
      // Dated by when Plaid said so, so the same bank needing it again next month is news again.
      out.push({
        id: `bank:${b.id}:${b.attention}:${b.since ? isoDay(b.since) : "undated"}`,
        item: {
          title: t("{bank} needs you to sign in again", { bank }),
          detail: `${t("Until you do, {product} can't see anything new from it.", { product })} ${t("Sign in again on Connections and it carries on where it left off.")}`,
          href: "/connections",
          urgent: true,
        },
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

/** How a change reads: with its amount ({amount}), without, and when it's too small to name. */
type Change = { more: string; less: string; moreBy: string; lessBy: string; same: string };

const WEEK_SPENT: Change = {
  more: msg("more than the week before"),
  less: msg("less than the week before"),
  moreBy: msg("{amount} more than the week before"),
  lessBy: msg("{amount} less than the week before"),
  same: msg("about the same as the week before"),
};
const SINCE_LAST_MONTH: Change = {
  more: msg("up since the end of last month"),
  less: msg("down since the end of last month"),
  moreBy: msg("{amount} up since the end of last month"),
  lessBy: msg("{amount} down since the end of last month"),
  same: msg("level with the end of last month"),
};
const MONTH_SPENT: Change = {
  more: msg("more spent than in {month}"),
  less: msg("less spent than in {month}"),
  moreBy: msg("{amount} more spent than in {month}"),
  lessBy: msg("{amount} less spent than in {month}"),
  same: msg("about the same spent as in {month}"),
};

/** "$40 more than the week before", "less than the week before": a change in words, never an arrow. */
function compared(now: Cents, before: Cents, amounts: boolean, words: Change, t: T, vars: Record<string, string> = {}): string {
  const d = now - before;
  if (Math.abs(d) < 100) return t(words.same, vars);
  if (!amounts) return t(d > 0 ? words.more : words.less, vars);
  return t(d > 0 ? words.moreBy : words.lessBy, { ...vars, amount: money0(Math.abs(d)) });
}

function summaryOf(r: Recipient, snap: AlertSnapshot | null, today: ISODate, fresh: boolean, t: T): Summary {
  const { locale } = t;
  const title = t("Your week");
  if (!snap || !fresh) {
    const unseen = snap
      ? t("{product} hasn't looked at your accounts since {date}, so there are no new figures this week.", { product, date: dayDate(snap.today, locale) })
      : t("{product} hasn't looked at your accounts lately, so there are no new figures this week.", { product });
    return { title, lines: [], note: `${unseen} ${t("Open {product} and next Monday's summary will have them.", { product })}` };
  }
  const w = snap.weekly;
  const lines: SummaryLine[] = [];
  const change = compared(w.spent, w.spentBefore, r.amounts, WEEK_SPENT, t);
  const from = shortDate(w.from, locale);
  const to = shortDate(w.to, locale);
  lines.push({
    label: t("Spent"),
    value: r.amounts ? t("{amount} from {from} to {to}, {change}", { amount: money0(w.spent), from, to, change }) : t("{Change}, {from} to {to}", { change, from, to }),
  });
  if (w.month && w.month.limit > 0) {
    lines.push({
      label: t("Budgets"),
      value: r.amounts
        ? t("{spent} of {limit} used so far this month", { spent: money0(w.month.spent), limit: money0(w.month.limit) })
        : t("{percent} used so far this month", { percent: percent(w.month.spent / w.month.limit) }),
    });
  }
  if (w.netWorthLastMonth !== null) {
    const moved = compared(w.netWorth, w.netWorthLastMonth, r.amounts, SINCE_LAST_MONTH, t);
    lines.push({ label: t("Net worth"), value: r.amounts ? `${money0(w.netWorth)}, ${moved}` : cap(moved, locale) });
  }
  if (snap.upcoming !== null) {
    const soon = snap.upcoming.filter((u) => u.date >= today && u.date <= addDays(today, BILL_LEAD_DAYS));
    lines.push({
      label: t("Coming up"),
      value: soon.length
        ? soon
            .slice(0, 6)
            .map((u) => {
              const date = dayDate(u.date, locale);
              return r.amounts ? t("{name} {amount} on {date}", { name: u.name, amount: money0(u.amount), date }) : t("{name} on {date}", { name: u.name, date });
            })
            .join("; ") + (soon.length > 6 ? `; ${t("and {n} more", { n: soon.length - 6 })}` : "")
        : t("Nothing {product} knows of is due in the next seven days.", { product }),
    });
  }
  return { title, lines, note: null };
}

const cap = (s: string, locale: T["locale"]) => `${s.charAt(0).toLocaleUpperCase(locale)}${s.slice(1)}`;
function list(xs: string[], t: T): string {
  return xs.length <= 1 ? xs.join("") : t("{list} and {last}", { list: xs.slice(0, -1).join(", "), last: xs.at(-1)! });
}

/**
 * Last month, in a few lines, early in this one: once a snapshot taken this
 * month has it, or on the 7th saying why it can't. Null while it waits, and
 * for a month Prism didn't hold whole (nothing to sum up, nothing wrong).
 */
function recapOf(r: Recipient, snap: AlertSnapshot | null, today: ISODate, t: T): { id: string; summary: Summary } | null {
  if (dayOfMonth(today) > RECAP_LAST_DAY) return null;
  const { locale } = t;
  const thisMonth = startOfMonth(today);
  const month = monthKey(addMonths(thisMonth, -1));
  const name = monthLong(`${month}-01`, locale);
  const id = `monthly:${month}`;
  const title = t("Your {month}", { month: name });
  const seenThisMonth = snap !== null && snap.today >= thisMonth;
  const m = seenThisMonth ? snap.monthly : null;
  if (!m || m.month !== month) {
    if (seenThisMonth || dayOfMonth(today) < RECAP_LAST_DAY) return null;
    const unseen = snap
      ? t("{product} hasn't looked at your accounts since {date}, so it can't sum up {month} here.", { product, date: dayDate(snap.today, locale), month: name })
      : t("{product} hasn't looked at your accounts lately, so it can't sum up {month} here.", { product, month: name });
    return { id, summary: { title, lines: [], note: `${unseen} ${t("Open {product} to see it on Cash flow.", { product })}` } };
  }
  const lines: SummaryLine[] = [];
  const kept = m.income - m.spent;
  const inOut = { income: money0(m.income), spent: money0(m.spent), kept: money0(Math.abs(kept)) };
  lines.push({
    label: t("In and out"),
    value: r.amounts
      ? kept >= 0
        ? t("{income} came in and {spent} went out, so you kept {kept}", inOut)
        : t("{income} came in and {spent} went out, so you spent {kept} more than came in", inOut)
      : kept >= 0
        ? t("You kept some of what came in")
        : t("You spent more than came in"),
  });
  if (m.before) {
    const prev = monthLong(`${monthKey(addMonths(`${month}-01`, -1))}-01`, locale);
    const spent = compared(m.spent, m.before.spent, r.amounts, MONTH_SPENT, t, { month: prev });
    lines.push({ label: t("Against {month}", { month: prev }), value: cap(spent, locale) });
  }
  if (m.top.length) {
    // A category's own name, translated here: the snapshot keeps it in English.
    const top = m.top.map((x) => ({ label: t(x.label), spent: x.spent }));
    lines.push({ label: t("Where it went"), value: r.amounts ? top.map((x) => `${x.label} ${money0(x.spent)}`).join(", ") : list(top.map((x) => x.label), t) });
  }
  if (m.netWorth) {
    const c = m.netWorth.change;
    const moved =
      Math.abs(c) < 100
        ? t("about level over the month")
        : !r.amounts
          ? c > 0
            ? t("up over the month")
            : t("down over the month")
          : c > 0
            ? t("up {amount} over the month", { amount: money0(c) })
            : t("down {amount} over the month", { amount: money0(-c) });
    lines.push({ label: t("Net worth"), value: r.amounts ? t("{amount} at the end of {month}, {change}", { amount: money0(m.netWorth.end), month: name, change: moved }) : cap(moved, locale) });
  }
  if (m.ahead) {
    const bills = m.ahead.count === 1 ? t("1 bill in the next 30 days") : t("{n} bills in the next 30 days", { n: m.ahead.count });
    lines.push({
      label: t("Coming up"),
      value:
        m.ahead.count === 0
          ? t("Nothing {product} knows of is due in the next 30 days.", { product })
          : r.amounts
            ? t("{bills}, about {amount} in all", { bills, amount: money0(m.ahead.total) })
            : cap(bills, locale),
    });
  }
  return { id, summary: { title, lines, note: null } };
}

function clip(s: string): string {
  return s.length <= SUBJECT_MAX ? s : `${s.slice(0, SUBJECT_MAX - 1).trimEnd()}…`;
}

/** Today's email for this person, in the language of `t`, or null when there's nothing new to send. */
export function emailFor(r: Recipient, now: Date, t: T = EN): Email | null {
  const today = localDay(r.timeZone, now);
  const snap = r.snapshot;
  // A snapshot from "tomorrow" (a visit from a zone ahead of the stored one) counts as fresh.
  const fresh = snap !== null && daysBetween(snap.today, today) <= SNAPSHOT_FRESH_DAYS;
  const candidates = [...(r.kinds.includes("bank") ? bankItems(r, now, t) : []), ...(snap && fresh ? snapshotItems(r, snap, today) : [])];

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
    const recap = recapOf(r, snap, today, t);
    const f = recap ? fingerprint(r.userId, recap.id) : null;
    if (recap && f && !r.sent.has(f)) {
      summary = recap.summary;
      prints.push(f);
    }
  }
  if (!summary && r.kinds.includes("weekly") && dayOfWeek(today) === 1) {
    const f = fingerprint(r.userId, `weekly:${today}`);
    if (!r.sent.has(f)) {
      summary = summaryOf(r, snap, today, fresh, t);
      prints.push(f);
    }
  }
  if (items.length === 0 && !summary) return null;

  const [first] = items;
  const subject = first ? clip(items.length > 1 ? t("{title}, and {n} more", { title: first.title, n: items.length - 1 }) : first.title) : t("{title} in {product}", { title: summary!.title, product });
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
 * counted, and they're in the email. Only ever a path on Prism to open. In
 * the email's language, `t`.
 */
export function phoneAlertFor(email: Email, t: T = EN): PhoneAlert {
  const [first, ...rest] = email.items;
  const fit = (s: string) => (s.length <= BODY_MAX ? s : `${s.slice(0, BODY_MAX - 1).trimEnd()}…`);
  if (first) {
    const more = rest.length + (email.summary ? 1 : 0);
    return { title: clip(first.title), body: fit(more ? `${first.detail} ${t("And {n} more in today's email.", { n: more })}` : first.detail), url: first.href };
  }
  const s = email.summary;
  const line = s?.note ?? (s?.lines[0] ? `${s.lines[0].label}: ${s.lines[0].value}` : t("Open {product} for this week's figures.", { product }));
  return { title: t("{title} in {product}", { title: s?.title ?? t("Your week"), product }), body: fit(line), url: "/" };
}
