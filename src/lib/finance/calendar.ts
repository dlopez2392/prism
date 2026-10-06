// src/lib/finance/calendar.ts
//
// Bill reminders for any calendar app: the recurring streams Prism found,
// written as an iCalendar (RFC 5545) file that Google Calendar, Apple Calendar
// and Outlook all read. Each bill is ONE recurring series (an RRULE), not a
// pile of single events, so "delete all future events" works in one tap the
// day a subscription is cancelled.
//
// Every event is all-day (a DATE, no time or zone): a bill is due on a day,
// and a floating date lands on that day wherever the phone is. Reminders fire
// at 9 AM relative to that day. UIDs are a stable hash of the stream, so a
// fresh download updates the same series instead of duplicating it, and a
// calendar that changes language renames its events rather than adding more.
// Every word is in the language of `t` (English unless asked): a person's own
// feed is in the language their visits last wrote its snapshot in.

import { BRAND } from "@/lib/brand";
import { addDays, dayOfMonth, dayOfWeek } from "./dates";
import { money, money0, shortDate } from "./format";
import { detectRecurring, upcoming, type Cadence, type RecurringStream } from "./recurring";
import type { Account, Cents, ISODate, Transaction } from "./types";
import type { Locale } from "@/lib/i18n/locale";
import { EN, msg, type T } from "@/lib/i18n/t";

export type Reminder = "none" | "same_day" | "day_before" | "three_days";

export const REMINDERS: { id: Reminder; label: string }[] = [
  { id: "day_before", label: "The day before, 9 AM" },
  { id: "same_day", label: "On the day, 9 AM" },
  { id: "three_days", label: "Three days before, 9 AM" },
  { id: "none", label: "No alerts" },
];

/** Relative to the all-day event's start (midnight): 9 AM on, the day before, three days before. */
const TRIGGERS: Record<Exclude<Reminder, "none">, string> = {
  same_day: "PT9H",
  day_before: "-PT15H",
  three_days: "-P2DT15H",
};

export function parseReminder(x: string | null | undefined): Reminder {
  return REMINDERS.some((r) => r.id === x) ? (x as Reminder) : "day_before";
}

/**
 * A year of each series: long enough to be useful, short enough not to
 * outlive a cancelled bill by much. A yearly bill gets two, so it still reads
 * as one that repeats.
 */
const OCCURRENCES: Record<Cadence, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, quarterly: 4, semiannual: 2, annual: 2 };
const EVERY: Record<Cadence, string> = {
  weekly: msg("every week"),
  biweekly: msg("every two weeks"),
  semimonthly: msg("twice a month"),
  monthly: msg("every month"),
  quarterly: msg("every three months"),
  semiannual: msg("twice a year"),
  annual: msg("every year"),
};
/** Months between a series' dates, for the cadences that keep the same day of the month. */
const INTERVAL: Partial<Record<Cadence, number>> = { quarterly: 3, semiannual: 6 };
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEKDAYS = "MO,TU,WE,TH,FR";
/** A calendar series can move a date off a weekend, but has no way to know a bank holiday. */
const weekday = (d: ISODate) => dayOfWeek(d) !== 0 && dayOfWeek(d) !== 6;

/**
 * A card's or a loan's next payment, as its lender states it (Plaid
 * Liabilities): one date, not a series — the next statement sets the next
 * one, and the calendar picks it up then.
 */
export type DueReminder = { accountId: string; name: string; mask: string | null; due: ISODate; minimum: Cents | null; statement: Cents | null };

/** The payments due from today on, from each account's lender terms. */
export function dueReminders(accounts: Pick<Account, "id" | "name" | "mask" | "liability">[], today: ISODate): DueReminder[] {
  return accounts.flatMap((a) => {
    const l = a.liability;
    return l?.dueDate && l.dueDate >= today ? [{ accountId: a.id, name: a.name, mask: a.mask, due: l.dueDate, minimum: l.minimumPayment, statement: l.statementBalance }] : [];
  });
}

const cents = (x: unknown) => x === null || (typeof x === "number" && Number.isInteger(x) && x >= 0);

/** A stored snapshot's due payment, checked before it's written into anyone's calendar. */
export function validDue(x: unknown): x is DueReminder {
  const d = x as Partial<DueReminder> | null;
  return (
    !!d &&
    typeof d.accountId === "string" &&
    typeof d.name === "string" &&
    (d.mask === null || typeof d.mask === "string") &&
    typeof d.due === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(d.due) &&
    cents(d.minimum) &&
    cents(d.statement)
  );
}

export type CalendarOptions = {
  streams: RecurringStream[];
  /** Card and loan payments due, from the lenders; none when Prism isn't reading them. */
  dues?: DueReminder[];
  accounts: Pick<Account, "id" | "name" | "mask" | "kind">[];
  today: ISODate;
  now: Date;
  /** Paydays are income landing in a checking account — not savings interest. */
  paydays: boolean;
  reminder: Reminder;
  /** Amounts in titles show on lock screens; some people would rather they didn't. */
  amountsInTitles: boolean;
  /** Absolute origin for the link back to the Future screen, e.g. https://prism.example.com */
  origin: string;
  calendarName: string;
  /** A subscribed feed says how often to refetch; a download says it is a snapshot. */
  feed: boolean;
  /** The language its words are in; English when not given. */
  t?: T;
};

/** An event's category, as calendar apps that show them read it: the English names Prism's own screens use, translated where written. */
const CATEGORY = { bills: msg("Bills"), subscriptions: msg("Subscriptions"), transfers: msg("Transfers"), paydays: msg("Paydays") } as const;

export type BillEvent = {
  uid: string;
  start: ISODate;
  rrule: string;
  title: string;
  description: string;
  category: string;
};

/** The first occurrence after the last real charge that is today or later, as the series itself would date it. */
export function firstUpcoming(stream: Pick<RecurringStream, "lastDate" | "cadence" | "schedule" | "nextDate">, today: ISODate): ISODate {
  let k = 0;
  for (const d of upcoming(stream, weekday)) {
    if (d >= today) return d;
    if (++k >= 800) break;
  }
  return stream.nextDate;
}

/**
 * The repeating series a stream becomes. One, except pay that comes twice a
 * month: a calendar rule can't alternate between two days, so each payday of
 * the month is its own series.
 */
export function seriesFor(stream: RecurringStream, today: ISODate): { key: string; start: ISODate; rrule: string }[] {
  const sch = stream.schedule;
  if (sch?.kind === "monthDays" && sch.days.length > 1) {
    return sch.days.map((day) => {
      const one = { ...stream, cadence: "monthly" as const, schedule: { kind: "monthDays" as const, days: [day] } };
      return { key: `${stream.id}|${day}`, start: firstUpcoming(one, today), rrule: rruleFor(one) };
    });
  }
  return [{ key: stream.id, start: firstUpcoming(stream, today), rrule: rruleFor(stream) }];
}

/** A pay rule's day of the month: that day, or the last weekday before it when it falls on a weekend. */
function monthDayRule(day: number, count: string): string {
  if (day >= 31) return `FREQ=MONTHLY;BYDAY=${WEEKDAYS};BYSETPOS=-1;${count}`;
  // The 1st or 2nd can move back into the month before, which a monthly rule can't reach: kept as is.
  if (day <= 2) return `FREQ=MONTHLY;BYMONTHDAY=${day};${count}`;
  const days = Array.from({ length: Math.min(5, day) }, (_, i) => day - Math.min(5, day) + 1 + i).join(",");
  return `FREQ=MONTHLY;BYMONTHDAY=${days};BYDAY=${WEEKDAYS};BYSETPOS=-1;${count}`;
}

/**
 * The recurrence rule. Monthly series anchor on the day of the LAST REAL
 * charge, and a bill due on the 29th–31st takes the last day that exists
 * (BYSETPOS=-1) — the same month-end clamping the forecast uses, instead of
 * RFC 5545's default of silently skipping short months.
 */
export function rruleFor(stream: Pick<RecurringStream, "lastDate" | "cadence" | "schedule">): string {
  const count = `COUNT=${OCCURRENCES[stream.cadence]}`;
  const sch = stream.schedule;
  if (sch?.kind === "weekday") return `FREQ=WEEKLY;${stream.cadence === "biweekly" ? "INTERVAL=2;" : ""}BYDAY=${BYDAY[sch.weekday]};${count}`;
  if (sch?.kind === "nthWeekday") return `FREQ=MONTHLY;BYDAY=${sch.nth}${BYDAY[sch.weekday]};COUNT=12`;
  if (sch?.kind === "monthDays" && sch.days.length === 1) return monthDayRule(sch.days[0]!, "COUNT=12");
  if (stream.cadence === "weekly") return `FREQ=WEEKLY;${count}`;
  if (stream.cadence === "biweekly") return `FREQ=WEEKLY;INTERVAL=2;${count}`;
  // Every month, every three or six, or every year in the month of the last charge.
  const freq =
    stream.cadence === "annual"
      ? `FREQ=YEARLY;BYMONTH=${Number(stream.lastDate.slice(5, 7))}`
      : `FREQ=MONTHLY${INTERVAL[stream.cadence] ? `;INTERVAL=${INTERVAL[stream.cadence]}` : ""}`;
  const day = dayOfMonth(stream.lastDate);
  if (day <= 28) return `${freq};BYMONTHDAY=${day};${count}`;
  const days = Array.from({ length: day - 27 }, (_, i) => 28 + i).join(",");
  return `${freq};BYMONTHDAY=${days};BYSETPOS=-1;${count}`;
}

const FNV_OFFSET = BigInt("0xcbf29ce484222325");
const FNV_PRIME = BigInt("0x100000001b3");
const MASK_64 = BigInt("0xffffffffffffffff");

/** 64-bit FNV-1a, hex: a stable, opaque UID that never exposes an account id. */
export function stableHash(s: string): string {
  let h = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(s)) {
    h ^= BigInt(byte);
    h = (h * FNV_PRIME) & MASK_64;
  }
  return h.toString(16).padStart(16, "0");
}

/** Income landing in checking. Interest on savings is income too, but nobody waits for it. */
function isPayday(s: RecurringStream, account: CalendarOptions["accounts"][number] | undefined): boolean {
  return s.kind === "income" && s.amount > 0 && account?.kind === "checking";
}

/**
 * The streams worth a reminder: everything going out, plus paydays. Money
 * arriving by transfer (the savings side of a transfer, a card receiving its
 * payment) is the other half of a bill already listed, so it is left out.
 */
export function remindable(streams: RecurringStream[], accounts: CalendarOptions["accounts"], paydays: boolean): RecurringStream[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return streams.filter((s) => s.amount < 0 || (paydays && isPayday(s, byId.get(s.accountId))));
}

export function billEvents(opts: CalendarOptions): BillEvent[] {
  const t = opts.t ?? EN;
  const { locale } = t;
  const accounts = new Map(opts.accounts.map((a) => [a.id, a]));
  const events: BillEvent[] = [];
  const more = t("See what's coming up: {url}", { url: `${opts.origin}/future` });
  for (const s of remindable(opts.streams, opts.accounts, opts.paydays)) {
    const account = accounts.get(s.accountId);
    const payday = isPayday(s, account);

    const exact = s.variable ? t("about {amount}", { amount: money0(Math.abs(s.amount)) }) : money(Math.abs(s.amount));
    const amount = payday ? `+${exact}` : exact;
    const title = payday ? t("Payday: {name}", { name: s.merchant }) : s.merchant;
    const vars = { amount, account: account ? `${account.name}${account.mask ? ` ••${account.mask}` : ""}` : "", every: t(EVERY[s.cadence]) };
    const expected = payday
      ? account
        ? t("Expected in: {amount} · {account} · {every}.", vars)
        : t("Expected in: {amount} · {every}.", vars)
      : account
        ? t("Expected out: {amount} · {account} · {every}.", vars)
        : t("Expected out: {amount} · {every}.", vars);

    const lines = [
      expected,
      s.variable
        ? t("The amount changes from one time to the next; this is the typical recent charge.")
        : payday
          ? t("Based on the last {n} deposits.", { n: s.occurrences })
          : t("Based on the last {n} charges.", { n: s.occurrences }),
    ];
    if (s.priceChange) {
      lines.push(
        t("The price went up from {from} to {to} on {date}.", {
          from: money(Math.abs(s.priceChange.from)),
          to: money(Math.abs(s.priceChange.to)),
          date: shortDate(s.priceChange.date, locale),
        }),
      );
    }
    lines.push("", more);

    for (const series of seriesFor(s, opts.today)) {
      events.push({
        uid: `${stableHash(series.key)}@prism.bis`,
        start: series.start,
        rrule: series.rrule,
        title: opts.amountsInTitles ? `${title} · ${amount}` : title,
        description: lines.join("\n"),
        category: t(payday ? CATEGORY.paydays : s.kind === "subscription" ? CATEGORY.subscriptions : s.kind === "transfer" ? CATEGORY.transfers : CATEGORY.bills),
      });
    }
  }
  for (const d of opts.dues ?? []) {
    if (d.due < opts.today) continue;
    const label = `${d.name}${d.mask ? ` ••${d.mask}` : ""}`;
    const owed = [
      d.minimum !== null ? t("minimum {amount}", { amount: money(d.minimum) }) : null,
      d.statement !== null ? t("statement balance {amount}", { amount: money(d.statement) }) : null,
    ].filter(Boolean);
    events.push({
      // One event per account and due date: a fresh copy updates it, and next month's is a new one.
      uid: `${stableHash(`due|${d.accountId}|${d.due}`)}@prism.bis`,
      start: d.due,
      rrule: "",
      title:
        opts.amountsInTitles && d.minimum !== null
          ? t("{account} payment due · {amount} min", { account: label, amount: money(d.minimum) })
          : t("{account} payment due", { account: label }),
      description: [
        owed.length ? t("Payment due: {owed}.", { owed: owed.join(" · ") }) : t("Payment due."),
        t("From your lender. The next statement brings the next due date."),
        "",
        more,
      ].join("\n"),
      category: t(CATEGORY.bills),
    });
  }
  return events.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.title.localeCompare(b.title, locale)));
}

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newline are escaped in TEXT. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/**
 * RFC 5545 §3.1: content lines are at most 75 OCTETS, continued with CRLF and
 * one space. Splits between code points, never inside a UTF-8 sequence, so a
 * merchant with an accent or an emoji survives folding.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines spend one octet on the leading space
    if (bytes + n > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += n;
  }
  out.push(current);
  return out.join("\r\n ");
}

const icsDate = (d: ISODate) => d.replace(/-/g, "");
const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function buildCalendar(opts: CalendarOptions): string {
  const t = opts.t ?? EN;
  const events = billEvents(opts);
  const stamp = icsStamp(opts.now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bespoke Intelligence Solutions//Prism//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.calendarName)}`,
    `X-WR-CALDESC:${escapeText(t("Bills, subscriptions and paydays {product} found repeating. Information, not financial advice.", { product: BRAND.product }))}`,
  ];
  if (opts.feed) lines.push("REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H");

  const footer = opts.feed
    ? t("This calendar updates itself.")
    : t("A snapshot from {date}. Download it again from {product} to refresh.", { date: shortDate(opts.today, t.locale), product: "Prism" });

  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(e.start)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(e.start, 1))}`,
      // A due date is a single day; a bill Prism found repeating is a series.
      ...(e.rrule ? [`RRULE:${e.rrule}`] : []),
      `SUMMARY:${escapeText(e.title)}`,
      `DESCRIPTION:${escapeText(`${e.description}\n${footer}`)}`,
      `CATEGORIES:${escapeText(e.category)}`,
      `URL:${opts.origin}/future`,
      // A reminder is not a meeting: never mark the day as busy.
      "TRANSP:TRANSPARENT",
    );
    if (opts.reminder !== "none") {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(e.title)}`, `TRIGGER:${TRIGGERS[opts.reminder]}`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}


/**
 * What a person's calendar feed publishes: their repeating bills and paydays
 * and the few account labels those name — never a balance, a transaction or
 * which transactions formed a stream — and the language to write them in, the
 * one their visit was in. Stored, then served to calendar apps that never sign
 * in, so it holds exactly what the calendar shows and no more.
 */
export function feedSnapshot(
  data: { transactions: Transaction[]; accounts: (CalendarOptions["accounts"][number] & Pick<Account, "liability">)[]; today: ISODate },
  lang: Locale = "en",
) {
  const streams = remindable(detectRecurring(data.transactions, data.today), data.accounts, true).map((s) => ({ ...s, transactionIds: [] as string[] }));
  const used = new Set(streams.map((s) => s.accountId));
  const accounts = data.accounts.filter((a) => used.has(a.id)).map(({ id, name, mask, kind }) => ({ id, name, mask, kind }));
  // A card's or a loan's next payment: its label, the date and what the lender asks — no balance history, no rate.
  return { v: 1 as const, builtOn: data.today, lang, streams, accounts, dues: dueReminders(data.accounts, data.today) };
}
