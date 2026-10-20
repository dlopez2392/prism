// Everything paid for again and again (subscriptions.ts): what counts, what
// the person said, what they added by hand, what they cancelled and whether
// it charged again, what's new, and Apple's and Google's bundles.

import { describe, expect, it } from "vitest";
import { validDetails, withOwnSub, withSubMark, NO_DETAILS, subscriptionNotes } from "./details";
import { alertsFor } from "./alerts";
import { analyze } from "./model";
import { detectRecurring } from "./recurring";
import { appStoreOf, cancelLinkFor, subscriptionsFor } from "./subscriptions";
import { monthly, tx } from "./test-helpers";
import type { FinanceData, Transaction } from "./types";

const TODAY = "2026-09-25";
const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

const streamflix = () => monthly(MONTHS, 3, -1_549, "Streamflix", "fun");
const gym = () => monthly(MONTHS, 5, -4_000, "Iron Gym", "health");
const power = () => monthly(MONTHS, 12, [-9_120, -11_480, -13_900, -15_210, -12_330, -9_870], "City Power", "bills");
// Yearly, twice: a membership that would read as a subscription if it came monthly.
const yearly = () => [tx("2024-09-10", -9_900, "Wordly Premium", "shopping"), tx("2025-09-10", -9_900, "Wordly Premium", "shopping")];

function subs(txns: Transaction[], notes = NO_DETAILS) {
  return subscriptionsFor(detectRecurring(txns, TODAY), txns, subscriptionNotes(notes), TODAY);
}

function data(txns: Transaction[], notes = NO_DETAILS): FinanceData {
  const n = subscriptionNotes(notes);
  return {
    source: "plaid",
    today: TODAY,
    household: { name: "Test", firstName: "Sam" },
    institutions: [{ id: "bank1", name: "First Bank", health: "healthy", lastSyncedAt: "2026-09-25T12:00:00Z", source: "plaid" }],
    accounts: [{ id: "chk", institutionId: "bank1", name: "Everyday Checking", mask: "1234", kind: "checking", balance: 500_000, history: [500_000], source: "plaid" }],
    transactions: txns.sort((a, b) => (a.date < b.date ? -1 : 1)),
    budgets: [],
    goals: [],
    holdings: [],
    credit: null,
    ...(n ? { subscriptionNotes: n } : {}),
  };
}

describe("subscriptions", () => {
  it("lists what's found, a yearly one included, and adds them up; a bill that varies isn't one", () => {
    const s = subs([...streamflix(), ...gym(), ...power(), ...yearly()]);
    expect(s.active.map((r) => r.name)).toEqual(["Iron Gym", "Streamflix", "Wordly Premium"]);
    const wordly = s.active.find((r) => r.name === "Wordly Premium")!;
    expect(wordly).toMatchObject({ cadence: "annual", amount: 9_900, monthly: 825, yearly: 9_900, source: "found", nextDate: "2026-09-10" });
    expect(s.monthly).toBe(4_000 + 1_549 + 825);
    expect(s.yearly).toBe(48_000 + 18_588 + 9_900);
    expect(s.others.map((o) => o.name)).toEqual(["City Power"]);
  });

  it("follows the person: a charge marked one counts, one marked not doesn't", () => {
    let notes = withSubMark(NO_DETAILS, "city power", { name: "City Power", is: true });
    notes = withSubMark(notes, "iron gym", { name: "Iron Gym", is: false });
    const s = subs([...streamflix(), ...gym(), ...power()], notes);
    expect(s.active.map((r) => [r.name, r.source])).toEqual([
      ["City Power", "marked"],
      ["Streamflix", "found"],
    ]);
    expect(s.others.map((o) => o.name)).toEqual(["Iron Gym"]);
  });

  it("counts one added by hand in the total, its next charge rolled on past today", () => {
    const notes = withOwnSub(NO_DETAILS, { id: "own-abc123", name: "Piano lessons", amount: 12_000, cadence: "monthly", next: "2026-06-15" });
    const s = subs(streamflix(), notes);
    expect(s.active.find((r) => r.source === "added")).toMatchObject({ key: "own-abc123", name: "Piano lessons", monthly: 12_000, nextDate: "2026-10-15", streamId: null });
    expect(s.monthly).toBe(12_000 + 1_549);
    // Taken out again.
    expect(subs(streamflix(), withOwnSub(notes, notes.own![0]!, true)).active.map((r) => r.source)).toEqual(["found"]);
  });

  it("moves a cancelled one to its own list, and catches a charge that came after", () => {
    const cancelled = withSubMark(NO_DETAILS, "streamflix", { name: "Streamflix", cancelled: { on: "2026-08-10", amount: 1_549, cadence: "monthly" } });
    const s = subs(streamflix(), cancelled);
    expect(s.active).toEqual([]);
    expect(s.cancelled).toHaveLength(1);
    const [c] = s.cancelled;
    expect(c).toMatchObject({ name: "Streamflix", on: "2026-08-10", yearly: 18_588 });
    // Sept 3 came after Aug 10: it shouldn't have.
    expect(c!.chargedSince.map((x) => x.date)).toEqual(["2026-09-03"]);

    const alerts = alertsFor(analyze(data(streamflix(), cancelled)));
    const still = alerts.find((a) => a.id.startsWith("subscription-still:"))!;
    expect(still).toMatchObject({ title: "Streamflix charged you after you cancelled", urgent: true, href: "/subscriptions", kind: "price-rise" });
    expect(still.detail).toContain("$15.49 on Sep 3");
    expect(still.quiet.detail).not.toMatch(/\$/);
  });

  it("gives a charge already on its way a few days' grace", () => {
    const cancelled = withSubMark(NO_DETAILS, "streamflix", { name: "Streamflix", cancelled: { on: "2026-09-01", amount: 1_549, cadence: "monthly" } });
    expect(subs(streamflix(), cancelled).cancelled[0]!.chargedSince).toEqual([]);
  });

  it("says when one is new, and when it followed a free trial", () => {
    const started = monthly(["2026-07", "2026-08", "2026-09"], 20, -1_299, "Tunecloud", "fun");
    const trial = tx("2026-06-20", -100, "Tunecloud", "fun");
    const s = subs([...streamflix(), ...started, trial]);
    expect(s.active.find((r) => r.name === "Tunecloud")).toMatchObject({ started: "2026-07-20", afterTrial: true });
    expect(s.active.find((r) => r.name === "Streamflix")).toMatchObject({ started: null, afterTrial: false });

    const alerts = alertsFor(analyze(data([...streamflix(), ...started, trial])));
    const news = alerts.find((a) => a.id === "subscription-new:tunecloud")!;
    expect(news.title).toBe("Your free trial of Tunecloud has ended");
    expect(news.detail).toBe("It charges you $12.99 a month, $156 a year. Its first full charge was on Jul 20.");
    // Without the trial charge, just new.
    expect(alertsFor(analyze(data([...streamflix(), ...started]))).find((a) => a.id === "subscription-new:tunecloud")!.title).toBe("New subscription: Tunecloud");
  });

  it("counts what Apple and Google billed in the last month, and knows where to cancel", () => {
    const s = subs([tx("2026-09-02", -999, "APPLE.COM/BILL", "fun"), tx("2026-09-14", -299, "APPLE.COM/BILL", "fun"), tx("2026-08-01", -499, "APPLE.COM/BILL", "fun"), tx("2026-09-20", -199, "GOOGLE *Play Pass", "fun")]);
    expect(s.appStores).toEqual([
      { store: "apple", charges: 2, total: 1_298 },
      { store: "google", charges: 1, total: 199 },
    ]);
    expect(appStoreOf("Apple Store #123")).toBeNull();
    expect(appStoreOf("Google *Google One")).toBeNull();
    expect(cancelLinkFor("NETFLIX.COM")?.service).toBe("Netflix");
    expect(cancelLinkFor("Google *Google One")?.service).toBe("Google One");
    expect(cancelLinkFor("APPLE.COM/BILL")?.service).toBe("Apple");
    expect(cancelLinkFor("Joe's Diner")).toBeNull();
    // Every link is the service's own page, over https.
    for (const m of ["netflix", "spotify", "hulu", "disney+", "hbo max", "paramount+", "peacock", "youtube", "audible", "amazon prime", "adobe", "microsoft", "dropbox", "nytimes", "dashpass", "linkedin", "openai", "anthropic"]) {
      expect(cancelLinkFor(m)?.url, m).toMatch(/^https:\/\//);
    }
  });

  it("keeps only what reads in the stored notes", () => {
    const stored = validDetails({
      v: 1,
      lines: {},
      subs: {
        "streamflix": { name: "Streamflix", is: true },
        "Not A Key": { name: "x", is: true },
        "iron gym": { name: "Iron Gym" },
        "tunecloud": { name: "Tunecloud", cancelled: { on: "2026-02-30", amount: 100, cadence: "monthly" } },
        "wordly premium": { name: "Wordly", cancelled: { on: "2026-09-01", amount: 9_900, cadence: "annual" } },
      },
      own: [
        { id: "own-abc123", name: "Piano", amount: 12_000, cadence: "monthly", next: "2026-10-01" },
        { id: "own-abc123", name: "Twice", amount: 1, cadence: "monthly", next: "2026-10-01" },
        { id: "bad", name: "Bad id", amount: 1, cadence: "monthly", next: "2026-10-01" },
        { id: "own-zzz999", name: "Too much", amount: 1_000_001, cadence: "monthly", next: "2026-10-01" },
        { id: "own-yyy888", name: "Fortnightly", amount: 100, cadence: "biweekly", next: "2026-10-01" },
      ],
    });
    expect(Object.keys(stored.subs ?? {})).toEqual(["streamflix", "wordly premium"]);
    expect(stored.own?.map((o) => o.name)).toEqual(["Piano"]);
  });

  it("keeps a person's notes out of totals until they say so: the insight agrees with the page", () => {
    const txns = [...streamflix(), ...gym(), ...yearly()];
    const a = analyze(data(txns));
    const insight = a.insights.find((i) => i.id === "subscriptions")!;
    expect(insight.title).toBe(`3 subscriptions cost you $${(a.subscriptions.yearly / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })} a year`);
  });
});
