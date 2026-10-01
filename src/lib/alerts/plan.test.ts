// Which alerts one person's email carries today (plan.ts): bank warnings
// straight from the database, bills and price rises only from a recent
// visit, the Monday summary on their own Monday even when there's nothing
// new to say, each piece once, and no dollar amount when they asked for none.

import { describe, expect, it } from "vitest";
import type { Alert } from "@/lib/finance/alerts";
import type { AlertSnapshot } from "@/lib/finance/alert-snapshot";
import { emailFor, fingerprint, localDay, type Recipient } from "./plan";

const U = "11111111-1111-4111-8111-111111111111";
// Monday Oct 5 2026, 13:00 UTC: 8 AM in Chicago, still Monday there.
const MONDAY = new Date("2026-10-05T13:00:00Z");
const TUESDAY = new Date("2026-10-06T13:00:00Z");

const bill: Alert = {
  id: "bill-short:oak street rent:2026-10-08",
  kind: "bill-short",
  title: "Oak Street Rent ($1,800) may not be covered on Thu, Oct 8",
  detail: "It's due before your paycheck on Fri, Oct 9, and Everyday Checking is on track to be $1,300 short after it.",
  quiet: { title: "Oak Street Rent may not be covered on Thu, Oct 8", detail: "It's due before your paycheck on Fri, Oct 9, and Everyday Checking is on track to be short after it." },
  on: "2026-10-08",
  href: "/future",
  urgent: true,
};
const rise: Alert = {
  id: "price-rise:stream-1:1599",
  kind: "price-rise",
  title: "StreamCo went up to $15.99",
  detail: "It was $12.99. That's $36 more a year, if you still use it.",
  quiet: { title: "StreamCo raised its price", detail: "Its latest charge, on Oct 1, was higher than the one before." },
  on: "2026-10-01",
  href: "/cash-flow",
  urgent: false,
};

function snapshot(over: Partial<AlertSnapshot> = {}): AlertSnapshot {
  return {
    v: 1,
    at: "2026-10-04T18:00:00.000Z",
    today: "2026-10-04",
    alerts: [bill, rise],
    weekly: { from: "2026-09-27", to: "2026-10-03", spent: 84_000, spentBefore: 80_000, month: { spent: 30_000, limit: 200_000 }, netWorth: 1_250_000, netWorthLastMonth: 1_200_000 },
    upcoming: [
      { name: "Oak Street Rent", date: "2026-10-08", amount: 180_000 },
      { name: "City Power", date: "2026-10-20", amount: 9_000 },
    ],
    ...over,
  };
}

function person(over: Partial<Recipient> = {}): Recipient {
  return { userId: U, email: "a@x.test", timeZone: "America/Chicago", kinds: ["bank", "bill-short", "price-rise", "weekly"], amounts: true, snapshot: snapshot(), banks: [], sent: new Set(), ...over };
}

const words = (e: ReturnType<typeof emailFor>) =>
  JSON.stringify([e?.subject, e?.items, e?.summary?.lines, e?.summary?.note]);

describe("an alert email", () => {
  it("carries a short bill and a price rise from the last visit, urgent first, each with its fingerprint", () => {
    const e = emailFor(person(), TUESDAY)!;
    expect(e.items.map((i) => i.title)).toEqual([bill.title, rise.title]);
    expect(e.subject).toBe(`${bill.title}, and 1 more`);
    expect(e.fingerprints).toEqual([fingerprint(U, bill.id), fingerprint(U, rise.id)]);
    expect(e.summary).toBeNull();
    expect(e.asOf).toBe("2026-10-04");
  });

  it("sends each piece once: what was already sent is left out, and nothing new means no email", () => {
    const sent = new Set([fingerprint(U, bill.id)]);
    expect(emailFor(person({ sent }), TUESDAY)!.items.map((i) => i.title)).toEqual([rise.title]);
    expect(emailFor(person({ sent: new Set([...sent, fingerprint(U, rise.id)]) }), TUESDAY)).toBeNull();
  });

  it("says nothing about bills or prices from a visit over a week old", () => {
    const old = snapshot({ today: "2026-09-27", at: "2026-09-27T18:00:00.000Z" });
    expect(emailFor(person({ snapshot: old }), TUESDAY)).toBeNull();
  });

  it("warns of a short bill from a week before it's due, and never once its day has passed", () => {
    const far = { ...bill, id: "bill-short:oak street rent:2026-10-20", on: "2026-10-20" };
    expect(emailFor(person({ snapshot: snapshot({ alerts: [far] }) }), TUESDAY)).toBeNull();
    // A week out, from a visit three days before.
    expect(emailFor(person({ snapshot: snapshot({ alerts: [far], today: "2026-10-10" }) }), new Date("2026-10-13T13:00:00Z"))?.items).toHaveLength(1);
    const past = { ...bill, on: "2026-10-05" };
    expect(emailFor(person({ snapshot: snapshot({ alerts: [past] }) }), TUESDAY)).toBeNull();
  });

  it("takes a bank's warning straight from the database, dated, so the same bank needing it again later is news again", () => {
    const banks = [{ id: "item-1", name: "First Bank", attention: "sign-in" as const, since: "2026-10-05T09:00:00Z", disconnectAt: null }];
    const e = emailFor(person({ snapshot: null, banks }), TUESDAY)!;
    expect(e.items).toEqual([expect.objectContaining({ title: "First Bank needs you to sign in again", href: "/connections", urgent: true })]);
    expect(e.fingerprints).toEqual([fingerprint(U, "bank:item-1:sign-in:2026-10-05")]);
    // A bank warning needs no snapshot, so the email claims no "as of".
    expect(e.asOf).toBeNull();
  });

  it("warns of a consent running out until its date, and not after", () => {
    const banks = [{ id: "item-1", name: "First Bank", attention: "disconnecting" as const, since: "2026-10-01T00:00:00Z", disconnectAt: "2026-10-08T13:25:17Z" }];
    const e = emailFor(person({ snapshot: null, banks }), TUESDAY)!;
    expect(e.items[0]!.title).toBe("First Bank stops updating on Thu, Oct 8");
    // The same id the Overview's Heads up uses for it.
    expect(e.fingerprints).toEqual([fingerprint(U, "bank:item-1:disconnect:2026-10-08")]);
    expect(emailFor(person({ snapshot: null, banks }), new Date("2026-10-09T13:00:00Z"))).toBeNull();
  });

  it("covers only the kinds the person chose", () => {
    const banks = [{ id: "item-1", name: "First Bank", attention: "revoked" as const, since: null, disconnectAt: null }];
    const e = emailFor(person({ banks, kinds: ["price-rise"] }), TUESDAY)!;
    expect(e.items.map((i) => i.title)).toEqual([rise.title]);
    expect(emailFor(person({ banks, kinds: [] }), MONDAY)).toBeNull();
  });

  it("with amounts off, carries no dollar figure anywhere, summary included", () => {
    const banks = [{ id: "item-1", name: "First Bank", attention: "sign-in" as const, since: null, disconnectAt: null }];
    const e = emailFor(person({ amounts: false, banks }), MONDAY)!;
    expect(e.items.map((i) => i.title)).toEqual(["First Bank needs you to sign in again", bill.quiet.title, rise.quiet.title]);
    expect(e.summary!.lines.length).toBeGreaterThan(2);
    expect(words(e)).not.toMatch(/\$|\d,\d{3}/);
  });
});

describe("the Monday summary", () => {
  it("goes on the person's own Monday, once, with the week in words: no arrows, and only what was measured", () => {
    const e = emailFor(person({ kinds: ["weekly"] }), MONDAY)!;
    expect(e.subject).toBe("Your week in Prism");
    expect(e.summary!.lines).toEqual([
      { label: "Spent", value: "$840 from Sep 27 to Oct 3, $40 more than the week before" },
      { label: "Budgets", value: "$300 of $2,000 used so far this month" },
      { label: "Net worth", value: "$12,500, $500 up since the end of last month" },
      { label: "Coming up", value: "Oak Street Rent $1,800 on Thu, Oct 8" },
    ]);
    expect(e.fingerprints).toEqual([fingerprint(U, "weekly:2026-10-05")]);
    expect(emailFor(person({ kinds: ["weekly"], sent: new Set(e.fingerprints) }), MONDAY)).toBeNull();
    expect(emailFor(person({ kinds: ["weekly"] }), TUESDAY)).toBeNull();
  });

  it("is Monday in the person's zone, not the server's", () => {
    // 03:00 UTC Monday is still Sunday evening in Chicago, and already Monday in Tokyo.
    const early = new Date("2026-10-05T03:00:00Z");
    expect(emailFor(person({ kinds: ["weekly"] }), early)).toBeNull();
    expect(emailFor(person({ kinds: ["weekly"], timeZone: "Asia/Tokyo" }), early)?.summary).not.toBeNull();
  });

  it("leaves out what wasn't measured: no budgets, no last month, no forecast", () => {
    const bare = snapshot({ alerts: [], upcoming: null, weekly: { ...snapshot().weekly, month: null, netWorthLastMonth: null } });
    expect(emailFor(person({ kinds: ["weekly"], snapshot: bare }), MONDAY)!.summary!.lines.map((l) => l.label)).toEqual(["Spent"]);
  });

  it("says so when nothing is due in the week, rather than leaving the line out", () => {
    const clear = snapshot({ upcoming: [{ name: "City Power", date: "2026-10-20", amount: 9_000 }] });
    expect(emailFor(person({ kinds: ["weekly"], snapshot: clear }), MONDAY)!.summary!.lines.at(-1)).toEqual({ label: "Coming up", value: "Nothing Prism knows of is due in the next seven days." });
  });

  it("still goes in a stale week, saying when Prism last looked, with no old figures dressed up as this week's", () => {
    const old = snapshot({ today: "2026-09-20", at: "2026-09-20T12:00:00.000Z" });
    const e = emailFor(person({ kinds: ["weekly"], snapshot: old }), MONDAY)!;
    expect(e.summary).toEqual({ title: "Your week", lines: [], note: expect.stringContaining("since Sun, Sep 20") });
    expect(e.asOf).toBeNull();
    expect(emailFor(person({ kinds: ["weekly"], snapshot: null }), MONDAY)!.summary!.note).toMatch(/hasn't looked at your accounts lately/);
  });
});

describe("a person's own day", () => {
  it("follows their zone, and falls back to UTC for one that's missing or unknown", () => {
    expect(localDay("America/Chicago", new Date("2026-10-05T03:00:00Z"))).toBe("2026-10-04");
    expect(localDay(null, new Date("2026-10-05T03:00:00Z"))).toBe("2026-10-05");
    expect(localDay("Mars/Olympus", new Date("2026-10-05T03:00:00Z"))).toBe("2026-10-05");
  });
});
