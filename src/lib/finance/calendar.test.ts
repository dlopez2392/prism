import { describe, expect, it } from "vitest";
import { billEvents, buildCalendar, escapeText, firstUpcoming, foldLine, parseReminder, remindable, rruleFor, stableHash, type CalendarOptions } from "./calendar";
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

  it("lands a bill due on the 29th–31st on the last day of a short month, not nowhere", () => {
    expect(rruleFor(stream({ lastDate: "2026-08-31" }))).toBe("FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1;COUNT=12");
    expect(rruleFor(stream({ lastDate: "2026-09-29" }))).toBe("FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1;COUNT=12");
    expect(rruleFor(stream({ lastDate: "2026-09-28" }))).toBe("FREQ=MONTHLY;BYMONTHDAY=28;COUNT=12");
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
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(17);
    expect(ics).toContain("SUMMARY:Payday: Lumen Design Co. payroll · +$2\\,981.40");
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
