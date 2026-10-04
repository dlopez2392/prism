import { describe, expect, it } from "vitest";
import { billEvents, buildCalendar, dueReminders, escapeText, firstUpcoming, foldLine, parseReminder, remindable, rruleFor, seriesFor, stableHash, validDue, type CalendarOptions } from "./calendar";
import { buildDemoData } from "./demo";
import { detectRecurring, type RecurringStream } from "./recurring";

const TODAY = "2026-09-27";

const stream = (over: Partial<RecurringStream> = {}): RecurringStream => ({
  id: "chk|rent|out",
  merchant: "Rent",
  accountId: "chk",
  category: "housing",
  kind: "bill",
  cadence: "monthly",
  amount: -195_000,
  variable: false,
  lastDate: "2026-09-01",
  nextDate: "2026-10-01",
  occurrences: 6,
  priceChange: null,
  transactionIds: [],
  ...over,
});

const accounts: CalendarOptions["accounts"] = [
  { id: "chk", name: "Everyday Checking", mask: "4821", kind: "checking" },
  { id: "sav", name: "Savings", mask: "9310", kind: "savings" },
  { id: "card", name: "Visa", mask: "1107", kind: "credit" },
];

const options = (over: Partial<CalendarOptions> = {}): CalendarOptions => ({
  streams: [stream()],
  accounts,
  today: TODAY,
  now: new Date("2026-09-27T10:00:00Z"),
  paydays: true,
  reminder: "day_before",
  amountsInTitles: true,
  origin: "https://prism.example",
  calendarName: "Prism: bills",
  feed: false,
  ...over,
});

describe("rruleFor", () => {
  it("repeats weekly, every two weeks and monthly for about a year", () => {
    expect(rruleFor(stream({ cadence: "weekly" }))).toBe("FREQ=WEEKLY;COUNT=52");
    expect(rruleFor(stream({ cadence: "biweekly" }))).toBe("FREQ=WEEKLY;INTERVAL=2;COUNT=26");
    expect(rruleFor(stream())).toBe("FREQ=MONTHLY;BYMONTHDAY=1;COUNT=12");
  });

  it("repeats every three or six months, and every year in the month it last came, for a year (two for a yearly one)", () => {
    expect(rruleFor(stream({ cadence: "quarterly", lastDate: "2026-07-06" }))).toBe("FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=6;COUNT=4");
    expect(rruleFor(stream({ cadence: "semiannual", lastDate: "2026-05-17" }))).toBe("FREQ=MONTHLY;INTERVAL=6;BYMONTHDAY=17;COUNT=2");
    expect(rruleFor(stream({ cadence: "annual", lastDate: "2026-03-31" }))).toBe("FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=28,29,30,31;BYSETPOS=-1;COUNT=2");
    // A leap day lands on Feb 28 in the years without one, as the forecast does.
    expect(rruleFor(stream({ cadence: "annual", lastDate: "2028-02-29" }))).toBe("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1;COUNT=2");
    expect(firstUpcoming(stream({ cadence: "quarterly", lastDate: "2026-01-31", nextDate: "2026-04-30" }), "2026-05-01")).toBe("2026-07-31");
  });

  it("lands a bill due on the 29th–31st on the last day of a short month, not nowhere", () => {
    expect(rruleFor(stream({ lastDate: "2026-08-31" }))).toBe("FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1;COUNT=12");
    expect(rruleFor(stream({ lastDate: "2026-09-29" }))).toBe("FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1;COUNT=12");
    expect(rruleFor(stream({ lastDate: "2026-09-28" }))).toBe("FREQ=MONTHLY;BYMONTHDAY=28;COUNT=12");
  });
});

describe("paydays that follow a rule", () => {
  const pay = (over: Partial<RecurringStream>) => stream({ id: "chk|acme|in", merchant: "Acme payroll", category: "income", kind: "income", amount: 250_000, ...over });

  it("repeats on the payday's own weekday, or its weekday of the month", () => {
    expect(rruleFor(pay({ cadence: "biweekly", schedule: { kind: "weekday", weekday: 5 } }))).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;COUNT=26");
    expect(rruleFor(pay({ cadence: "monthly", schedule: { kind: "nthWeekday", weekday: 3, nth: 2 } }))).toBe("FREQ=MONTHLY;BYDAY=2WE;COUNT=12");
    expect(rruleFor(pay({ cadence: "monthly", schedule: { kind: "nthWeekday", weekday: 5, nth: -1 } }))).toBe("FREQ=MONTHLY;BYDAY=-1FR;COUNT=12");
  });

  it("makes pay twice a month two series, each on the last weekday on or before its day", () => {
    const s = pay({ cadence: "semimonthly", lastDate: "2026-09-15", nextDate: "2026-09-30", schedule: { kind: "monthDays", days: [15, 31] } });
    expect(seriesFor(s, TODAY)).toEqual([
      { key: "chk|acme|in|15", start: "2026-10-15", rrule: "FREQ=MONTHLY;BYMONTHDAY=11,12,13,14,15;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=12" },
      { key: "chk|acme|in|31", start: "2026-09-30", rrule: "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=12" },
    ]);
    const events = billEvents(options({ streams: [s] }));
    expect(events.map((e) => [e.start, e.category])).toEqual([
      ["2026-09-30", "Paydays"],
      ["2026-10-15", "Paydays"],
    ]);
    expect(new Set(events.map((e) => e.uid)).size).toBe(2);
    expect(events[0]!.description).toContain("twice a month");
  });

  it("starts a series on a date the series itself names: a weekend moves, a holiday it can't know doesn't", () => {
    // Every other Friday from Dec 18: Jan 1 2027 is a holiday, paid Dec 31, but a calendar rule can only say Friday.
    expect(firstUpcoming(pay({ cadence: "biweekly", lastDate: "2026-12-18", schedule: { kind: "weekday", weekday: 5 } }), "2026-12-20")).toBe("2027-01-01");
    // The 31st in October is a Saturday: the series says Friday the 30th, and so does its start.
    expect(firstUpcoming(pay({ lastDate: "2026-09-30", schedule: { kind: "monthDays", days: [31] } }), "2026-10-01")).toBe("2026-10-30");
  });
});

describe("firstUpcoming", () => {
  it("is the next cycle after the last real charge", () => {
    expect(firstUpcoming(stream(), TODAY)).toBe("2026-10-01");
  });

  it("skips a missed cycle rather than reminding about the past", () => {
    expect(firstUpcoming(stream({ lastDate: "2026-08-19", nextDate: "2026-09-19" }), TODAY)).toBe("2026-10-19");
  });

  it("keeps a charge due today", () => {
    expect(firstUpcoming(stream({ lastDate: "2026-08-27" }), TODAY)).toBe(TODAY);
  });
});

describe("which streams get a reminder", () => {
  const streams = [
    stream(),
    stream({ id: "chk|pay|in", merchant: "Payroll", kind: "income", category: "income", amount: 298_140, cadence: "biweekly" }),
    stream({ id: "sav|interest|in", merchant: "Interest", accountId: "sav", kind: "income", category: "income", amount: 6_306 }),
    stream({ id: "sav|xfer|in", merchant: "Transfer from checking", accountId: "sav", kind: "transfer", category: "transfer", amount: 90_000 }),
    stream({ id: "card|stream|out", merchant: "Streamflix", accountId: "card", kind: "subscription", category: "fun", amount: -1_799 }),
  ];

  it("keeps bills, subscriptions and checking paydays; drops interest and incoming transfers", () => {
    expect(remindable(streams, accounts, true).map((s) => s.merchant)).toEqual(["Rent", "Payroll", "Streamflix"]);
  });

  it("drops paydays when asked", () => {
    expect(remindable(streams, accounts, false).map((s) => s.merchant)).toEqual(["Rent", "Streamflix"]);
  });

  it("names paydays, categorises every event and orders them by date", () => {
    const events = billEvents(options({ streams }));
    // Biweekly from Sep 1 puts payday on Sep 29, ahead of the bills due Oct 1.
    expect(events.map((e) => [e.start, e.title, e.category])).toEqual([
      ["2026-09-29", "Payday: Payroll · +$2,981.40", "Paydays"],
      ["2026-10-01", "Rent · $1,950.00", "Bills"],
      ["2026-10-01", "Streamflix · $17.99", "Subscriptions"],
    ]);
  });
});

describe("billEvents", () => {
  it("keeps amounts out of titles on request, but never out of the notes", () => {
    const [e] = billEvents(options({ amountsInTitles: false }));
    expect(e!.title).toBe("Rent");
    expect(e!.description).toContain("$1,950.00");
  });

  it("calls a variable bill an estimate and flags a price rise", () => {
    const [bill] = billEvents(options({ streams: [stream({ variable: true, amount: -13_930 })] }));
    expect(bill!.title).toBe("Rent · about $139");
    const [sub] = billEvents(options({ streams: [stream({ amount: -1_799, priceChange: { from: -1_549, to: -1_799, date: "2026-08-22" } })] }));
    expect(sub!.description).toContain("went up from $15.49 to $17.99 on Aug 22");
  });

  it("uses a stable, opaque UID that never shows the account id", () => {
    const [a] = billEvents(options());
    const [b] = billEvents(options({ now: new Date("2027-01-01T00:00:00Z") }));
    expect(a!.uid).toBe(b!.uid);
    expect(a!.uid).toMatch(/^[0-9a-f]{16}@prism\.bis$/);
    expect(a!.uid).not.toContain("chk");
    expect(stableHash("a")).not.toBe(stableHash("b"));
  });
});

describe("iCalendar text", () => {
  it("escapes the characters RFC 5545 reserves", () => {
    expect(escapeText("Power, Light; & Co\\op\nline")).toBe("Power\\, Light\\; & Co\\\\op\\nline");
  });

  it("folds at 75 octets without splitting a character", () => {
    const line = `SUMMARY:${"Café ☕ ".repeat(30)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join("")).toBe(line);
  });

  it("leaves a short line alone", () => {
    expect(foldLine("VERSION:2.0")).toBe("VERSION:2.0");
  });
});

describe("buildCalendar", () => {
  it("writes a well-formed calendar with CRLF lines and an all-day series per bill", () => {
    const ics = buildCalendar(options());
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261001\r\nDTEND;VALUE=DATE:20261002\r\n");
    expect(ics).toContain("RRULE:FREQ=MONTHLY;BYMONTHDAY=1;COUNT=12");
    expect(ics).toContain("DTSTAMP:20260927T100000Z");
    expect(ics).toContain("TRANSP:TRANSPARENT");
    expect(ics).toContain("TRIGGER:-PT15H");
    expect(ics).not.toContain("REFRESH-INTERVAL");
  });

  it("sets the reminder the person picked, or none", () => {
    expect(buildCalendar(options({ reminder: "three_days" }))).toContain("TRIGGER:-P2DT15H");
    expect(buildCalendar(options({ reminder: "same_day" }))).toContain("TRIGGER:PT9H");
    expect(buildCalendar(options({ reminder: "none" }))).not.toContain("VALARM");
  });

  it("tells a subscribed feed how often to refresh", () => {
    const ics = buildCalendar(options({ feed: true }));
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT12H");
    expect(ics).toContain("This calendar updates itself.");
  });

  it("covers the demo household's bills end to end", () => {
    const data = buildDemoData(TODAY);
    const ics = buildCalendar(options({ streams: detectRecurring(data.transactions, TODAY), accounts: data.accounts }));
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(20);
    expect(ics).toContain("SUMMARY:Payday: Lumen Design Co. payroll · +$2\\,981.40");
    // The bills that don't come monthly, each a series of its own.
    expect(ics).toContain("DTSTART;VALUE=DATE:20261006\r\nDTEND;VALUE=DATE:20261007\r\nRRULE:FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=6;COUNT=4");
    expect(ics).toContain("RRULE:FREQ=MONTHLY;INTERVAL=6;BYMONTHDAY=17;COUNT=2");
    expect(ics).toContain("DTSTART;VALUE=DATE:20270901\r\nDTEND;VALUE=DATE:20270902\r\nRRULE:FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=1;COUNT=2");
    expect(ics.replace(/\r\n /g, "")).toContain("DESCRIPTION:Expected out: $139.00 · Everyday Checking ••4821 · every year.");
    expect(ics).not.toContain("Transfer from Everyday Checking");
    expect(ics).not.toContain("Interest earned");
  });
});

describe("parseReminder", () => {
  it("falls back to the day before for anything unknown", () => {
    expect(parseReminder("three_days")).toBe("three_days");
    expect(parseReminder("<script>")).toBe("day_before");
    expect(parseReminder(null)).toBe("day_before");
  });
});

describe("feedSnapshot", () => {
  it("publishes bills and paydays only — no balances, no transactions, no stray accounts", async () => {
    const { feedSnapshot } = await import("./calendar");
    const data = buildDemoData(TODAY);
    const snap = feedSnapshot(data);
    expect(snap.v).toBe(1);
    expect(snap.streams).toHaveLength(20);
    expect(snap.streams.every((s) => s.transactionIds.length === 0)).toBe(true);
    for (const a of snap.accounts) expect(Object.keys(a).sort()).toEqual(["id", "kind", "mask", "name"]);
    const used = new Set(snap.streams.map((s) => s.accountId));
    expect(snap.accounts.every((a) => used.has(a.id))).toBe(true);
    expect(JSON.stringify(snap)).not.toMatch(/"balance"|"history"/);
    // The snapshot is exactly what the calendar needs: rebuilding from it gives the same file.
    const fromData = buildCalendar(options({ streams: detectRecurring(data.transactions, TODAY), accounts: data.accounts }));
    const fromSnap = buildCalendar(options({ streams: snap.streams, accounts: snap.accounts }));
    expect(fromSnap).toBe(fromData);
  });

  it("is empty for a household with nothing repeating", async () => {
    const { feedSnapshot } = await import("./calendar");
    expect(feedSnapshot({ transactions: [], accounts: [], today: TODAY })).toEqual({ v: 1, builtOn: TODAY, streams: [], accounts: [], dues: [] });
  });
});

describe("card and loan payments due", () => {
  const due = { accountId: "card", name: "Visa", mask: "1107", due: "2026-10-14", minimum: 3_500, statement: 124_050 };

  it("are one day each, not a series, with the lender's amounts", () => {
    const ics = buildCalendar(options({ streams: [], dues: [due] }));
    const event = ics.split("BEGIN:VEVENT")[1]!;
    expect(event).toContain("DTSTART;VALUE=DATE:20261014");
    expect(event).not.toContain("RRULE");
    expect(event).toContain("SUMMARY:Visa ••1107 payment due · $35.00 min");
    expect(event.replace(/\r\n /g, "")).toContain("Payment due: minimum $35.00 · statement balance $1\\,240.50.");
    expect(event).toContain("CATEGORIES:Bills");
    // No account id in the UID, and a fresh copy updates the same event.
    expect(event).toContain(`UID:${stableHash("due|card|2026-10-14")}@prism.bis`);
  });

  it("keep amounts off the title when asked, and leave out a date already past", () => {
    const [e] = billEvents(options({ streams: [], dues: [due, { ...due, accountId: "old", due: "2026-09-20" }], amountsInTitles: false }));
    expect(billEvents(options({ streams: [], dues: [due, { ...due, accountId: "old", due: "2026-09-20" }] }))).toHaveLength(1);
    expect(e!.title).toBe("Visa ••1107 payment due");
  });

  it("come from the accounts' lender terms, and only those still ahead", () => {
    const withTerms = [
      { id: "card", name: "Visa", mask: "1107", liability: { dueDate: "2026-10-14", minimumPayment: 3_500, statementBalance: 124_050, apr: 24.99, overdue: false } },
      { id: "loan", name: "Auto loan", mask: null, liability: { dueDate: null, minimumPayment: 38_900, statementBalance: null, apr: 6.9, overdue: false } },
      { id: "chk", name: "Checking", mask: "4821" },
    ];
    expect(dueReminders(withTerms, TODAY)).toEqual([due]);
  });

  it("from a stored feed are checked before they reach a calendar", () => {
    expect(validDue(due)).toBe(true);
    for (const bad of [null, { ...due, due: "Oct 14" }, { ...due, minimum: -5 }, { ...due, minimum: 3.5 }, { ...due, name: 7 }, { ...due, mask: undefined }]) expect(validDue(bad)).toBe(false);
  });
});
