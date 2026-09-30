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
// fresh download updates the same series instead of duplicating it.

import { addDays, dayOfMonth } from "./dates";
import { money, money0, shortDate } from "./format";
import { detectRecurring, nthAfter, type Cadence, type RecurringStream } from "./recurring";
import type { Account, Cents, ISODate, Transaction } from "./types";

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

/** A year of each series: long enough to be useful, short enough not to outlive a cancelled bill by much. */
const OCCURRENCES: Record<Cadence, number> = { weekly: 52, biweekly: 26, monthly: 12 };
const EVERY: Record<Cadence, string> = { weekly: "every week", biweekly: "every two weeks", monthly: "every month" };

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
};

export type BillEvent = {
  uid: string;
  start: ISODate;
  rrule: string;
  title: string;
  description: string;
  category: "Bills" | "Subscriptions" | "Transfers" | "Paydays";
};

/** The first occurrence after the last real charge that is today or later. */
export function firstUpcoming(stream: RecurringStream, today: ISODate): ISODate {
  for (let k = 1; k < 800; k++) {
    const d = nthAfter(stream.lastDate, stream.cadence, k);
    if (d >= today) return d;
  }
  return stream.nextDate;
}

/**
 * The recurrence rule. Monthly series anchor on the day of the LAST REAL
 * charge, and a bill due on the 29th–31st takes the last day that exists
 * (BYSETPOS=-1) — the same month-end clamping the forecast uses, instead of
 * RFC 5545's default of silently skipping short months.
 */
export function rruleFor(stream: RecurringStream): string {
  const count = `COUNT=${OCCURRENCES[stream.cadence]}`;
  if (stream.cadence === "weekly") return `FREQ=WEEKLY;${count}`;
  if (stream.cadence === "biweekly") return `FREQ=WEEKLY;INTERVAL=2;${count}`;
  const day = dayOfMonth(stream.lastDate);
  if (day <= 28) return `FREQ=MONTHLY;BYMONTHDAY=${day};${count}`;
  const days = Array.from({ length: day - 27 }, (_, i) => 28 + i).join(",");
  return `FREQ=MONTHLY;BYMONTHDAY=${days};BYSETPOS=-1;${count}`;
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
  const accounts = new Map(opts.accounts.map((a) => [a.id, a]));
  const events: BillEvent[] = [];
  for (const s of remindable(opts.streams, opts.accounts, opts.paydays)) {
    const account = accounts.get(s.accountId);
    const payday = isPayday(s, account);

    const exact = s.variable ? `about ${money0(Math.abs(s.amount))}` : money(Math.abs(s.amount));
    const amount = payday ? `+${exact}` : exact;
    const title = payday ? `Payday: ${s.merchant}` : s.merchant;
    const where = account ? `${account.name}${account.mask ? ` ••${account.mask}` : ""}` : null;

    const lines = [
      `${payday ? "Expected in" : "Expected out"}: ${amount}${where ? ` · ${where}` : ""} · ${EVERY[s.cadence]}.`,
      s.variable
        ? "The amount changes from one time to the next; this is the typical recent charge."
        : `Based on the last ${s.occurrences} ${payday ? "deposits" : "charges"}.`,
    ];
    if (s.priceChange) {
      lines.push(`The price went up from ${money(Math.abs(s.priceChange.from))} to ${money(Math.abs(s.priceChange.to))} on ${shortDate(s.priceChange.date)}.`);
    }
    lines.push("", `See what's coming up: ${opts.origin}/future`);

    events.push({
      uid: `${stableHash(s.id)}@prism.bis`,
      start: firstUpcoming(s, opts.today),
      rrule: rruleFor(s),
      title: opts.amountsInTitles ? `${title} · ${amount}` : title,
      description: lines.join("\n"),
      category: payday ? "Paydays" : s.kind === "subscription" ? "Subscriptions" : s.kind === "transfer" ? "Transfers" : "Bills",
    });
  }
  for (const d of opts.dues ?? []) {
    if (d.due < opts.today) continue;
    const label = `${d.name}${d.mask ? ` ••${d.mask}` : ""}`;
    const owed = [d.minimum !== null ? `minimum ${money(d.minimum)}` : null, d.statement !== null ? `statement balance ${money(d.statement)}` : null].filter(Boolean);
    events.push({
      // One event per account and due date: a fresh copy updates it, and next month's is a new one.
      uid: `${stableHash(`due|${d.accountId}|${d.due}`)}@prism.bis`,
      start: d.due,
      rrule: "",
      title: opts.amountsInTitles && d.minimum !== null ? `${label} payment due · ${money(d.minimum)} min` : `${label} payment due`,
      description: [
        `Payment due${owed.length ? `: ${owed.join(" · ")}` : ""}.`,
        "From your lender. The next statement brings the next due date.",
        "",
        `See what's coming up: ${opts.origin}/future`,
      ].join("\n"),
      category: "Bills",
    });
  }
  return events.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.title.localeCompare(b.title)));
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
  const events = billEvents(opts);
  const stamp = icsStamp(opts.now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bespoke Intelligence Solutions//Prism//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.calendarName)}`,
    `X-WR-CALDESC:${escapeText("Bills, subscriptions and paydays Prism found repeating. Information, not financial advice.")}`,
  ];
  if (opts.feed) lines.push("REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H");

  const footer = opts.feed
    ? "This calendar updates itself."
    : `A snapshot from ${shortDate(opts.today)}. Download it again from Prism to refresh.`;

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
      `CATEGORIES:${e.category}`,
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
 * which transactions formed a stream. Stored, then served to calendar apps
 * that never sign in, so it holds exactly what the calendar shows and no more.
 */
export function feedSnapshot(data: { transactions: Transaction[]; accounts: (CalendarOptions["accounts"][number] & Pick<Account, "liability">)[]; today: ISODate }) {
  const streams = remindable(detectRecurring(data.transactions, data.today), data.accounts, true).map((s) => ({ ...s, transactionIds: [] as string[] }));
  const used = new Set(streams.map((s) => s.accountId));
  const accounts = data.accounts.filter((a) => used.has(a.id)).map(({ id, name, mask, kind }) => ({ id, name, mask, kind }));
  // A card's or a loan's next payment: its label, the date and what the lender asks — no balance history, no rate.
  return { v: 1 as const, builtOn: data.today, streams, accounts, dues: dueReminders(data.accounts, data.today) };
}
