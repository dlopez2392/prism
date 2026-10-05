// Which alerts one person's email carries today (plan.ts): bank warnings
// straight from the database, bills and price rises only from a recent
// visit, the Monday summary on their own Monday even when there's nothing
// new to say, each piece once, and no dollar amount when they asked for none;
// and all of it in Spanish for someone who reads Prism in Spanish.

import { describe, expect, it } from "vitest";
import type { Alert } from "@/lib/finance/alerts";
import type { AlertSnapshot, MonthlyNumbers } from "@/lib/finance/alert-snapshot";
import { translator } from "@/lib/i18n/translator";
import { emailFor, fingerprint, localDay, phoneAlertFor, type Recipient } from "./plan";

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
    by: "visit",
    today: "2026-10-04",
    lang: "en",
    alerts: [bill, rise],
    weekly: { from: "2026-09-27", to: "2026-10-03", spent: 84_000, spentBefore: 80_000, month: { spent: 30_000, limit: 200_000 }, netWorth: 1_250_000, netWorthLastMonth: 1_200_000 },
    monthly: null,
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
    expect(e.asOf).toEqual({ day: "2026-10-04", by: "visit" });
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

describe("the same news on a phone", () => {
  it("leads with the most urgent item in the email's own words, counts the rest, and opens where the email's link does", () => {
    const e = emailFor(person(), MONDAY)!;
    expect(phoneAlertFor(e)).toEqual({
      title: "Oak Street Rent ($1,800) may not be covered on Thu, Oct 8",
      body: "It's due before your paycheck on Fri, Oct 9, and Everyday Checking is on track to be $1,300 short after it. And 2 more in today's email.",
      url: "/future",
    });
  });

  it("never shows an amount the person turned off", () => {
    const quiet = phoneAlertFor(emailFor(person({ amounts: false }), MONDAY)!);
    expect(JSON.stringify(quiet)).not.toMatch(/\$|\d,\d{3}/);
    expect(quiet.title).toBe("Oak Street Rent may not be covered on Thu, Oct 8");
  });

  it("sends a Monday with nothing else as the week's first line, or its note", () => {
    expect(phoneAlertFor(emailFor(person({ kinds: ["weekly"] }), MONDAY)!)).toEqual({
      title: "Your week in Prism",
      body: "Spent: $840 from Sep 27 to Oct 3, $40 more than the week before",
      url: "/",
    });
    const stale = phoneAlertFor(emailFor(person({ kinds: ["weekly"], snapshot: null }), MONDAY)!);
    expect(stale.body).toMatch(/hasn't looked at your accounts lately/);
  });

  it("fits a lock screen", () => {
    const long = { ...bill, id: "bill-short:x:2026-10-08", title: "T".repeat(300), detail: "D".repeat(400) };
    const p = phoneAlertFor(emailFor(person({ snapshot: snapshot({ alerts: [long] }), kinds: ["bill-short"] }), TUESDAY)!);
    expect(p.title.length).toBeLessThanOrEqual(120);
    expect(p.body.length).toBeLessThanOrEqual(240);
  });
});

describe("the recap of last month", () => {
  // Friday Oct 2 2026, 8 AM in Chicago.
  const at = (day: string) => new Date(`2026-10-${day}T13:00:00Z`);
  const september: MonthlyNumbers = {
    month: "2026-09",
    income: 582_000,
    spent: 410_000,
    before: { income: 560_000, spent: 440_000 },
    top: [
      { label: "Housing", spent: 195_000 },
      { label: "Food & dining", spent: 62_000 },
      { label: "Transport", spent: 41_000 },
    ],
    netWorth: { end: 8_420_000, change: 120_000 },
    ahead: { count: 9, total: 310_000 },
  };
  const seen = (day: string, monthly: MonthlyNumbers | null = september) => snapshot({ today: `2026-10-${day}`, at: `2026-10-${day}T12:00:00.000Z`, alerts: [], monthly });
  const recap = (over: Partial<Recipient>, day: string) => emailFor(person({ kinds: ["weekly"], ...over }), at(day));

  it("goes out the first morning a snapshot from this month has it, in a few lines, once", () => {
    const e = recap({ snapshot: seen("02") }, "02")!;
    expect(e.subject).toBe("Your September in Prism");
    expect(e.summary).toEqual({
      title: "Your September",
      lines: [
        { label: "In and out", value: "$5,820 came in and $4,100 went out, so you kept $1,720" },
        { label: "Against August", value: "$300 less spent than in August" },
        { label: "Where it went", value: "Housing $1,950, Food & dining $620, Transport $410" },
        { label: "Net worth", value: "$84,200 at the end of September, up $1,200 over the month" },
        { label: "Coming up", value: "9 bills in the next 30 days, about $3,100 in all" },
      ],
      note: null,
    });
    expect(e.fingerprints).toEqual([fingerprint(U, "monthly:2026-09")]);
    expect(e.asOf).toEqual({ day: "2026-10-02", by: "visit" });
    expect(recap({ snapshot: seen("02"), sent: new Set(e.fingerprints) }, "03")).toBeNull();
    expect(phoneAlertFor(e)).toEqual({ title: "Your September in Prism", body: "In and out: $5,820 came in and $4,100 went out, so you kept $1,720", url: "/" });
  });

  it("says it in words alone when amounts are off", () => {
    const e = recap({ snapshot: seen("02"), amounts: false }, "02")!;
    expect(JSON.stringify(e.summary)).not.toMatch(/\$|\d,\d{3}/);
    expect(e.summary!.lines.map((l) => l.value)).toEqual([
      "You kept some of what came in",
      "Less spent than in August",
      "Housing, Food & dining and Transport",
      "Up over the month",
      "9 bills in the next 30 days",
    ]);
  });

  it("says when more went out than came in, and leaves out what it doesn't know", () => {
    const lean: MonthlyNumbers = { ...september, income: 300_000, before: null, top: [], netWorth: null, ahead: { count: 1, total: 5_000 } };
    expect(recap({ snapshot: seen("02", lean) }, "02")!.summary!.lines).toEqual([
      { label: "In and out", value: "$3,000 came in and $4,100 went out, so you spent $1,100 more than came in" },
      { label: "Coming up", value: "1 bill in the next 30 days, about $50 in all" },
    ]);
    expect(recap({ snapshot: seen("02", lean), amounts: false }, "02")!.summary!.lines[0]!.value).toBe("You spent more than came in");
    expect(recap({ snapshot: seen("02", { ...lean, ahead: { count: 0, total: 0 } }) }, "02")!.summary!.lines[1]!.value).toBe("Nothing Prism knows of is due in the next 30 days.");
    expect(recap({ snapshot: seen("02", { ...lean, ahead: null }) }, "02")!.summary!.lines).toHaveLength(1);
    // Net worth that fell, and one that barely moved.
    const nw = (change: number, amounts = true) => recap({ snapshot: seen("02", { ...lean, ahead: null, netWorth: { end: 8_000_000, change } }), amounts }, "02")!.summary!.lines[1]!.value;
    expect(nw(-250_000)).toBe("$80,000 at the end of September, down $2,500 over the month");
    expect(nw(99)).toBe("$80,000 at the end of September, about level over the month");
    expect(nw(-100)).toBe("$80,000 at the end of September, down $1 over the month");
    expect(nw(-250_000, false)).toBe("Down over the month");
  });

  it("waits for a snapshot from this month until the 7th, then says why there are no figures", () => {
    const old = snapshot({ today: "2026-09-29", at: "2026-09-29T12:00:00.000Z", alerts: [] });
    expect(recap({ snapshot: old }, "02")).toBeNull();
    expect(recap({ snapshot: old }, "06")).toBeNull();
    const late = recap({ snapshot: old }, "07")!;
    expect(late.summary).toEqual({ title: "Your September", lines: [], note: "Prism hasn't looked at your accounts since Tue, Sep 29, so it can't sum up September here. Open Prism to see it on Cash flow." });
    expect(late.asOf).toBeNull();
    expect(recap({ snapshot: null }, "07")!.summary!.note).toMatch(/hasn't looked at your accounts lately/);
    expect(recap({ snapshot: old }, "08")).toBeNull();
  });

  it("counts a snapshot taken on the 1st, never sends a month that isn't last month, and says $0 kept plainly", () => {
    expect(recap({ snapshot: seen("01") }, "01")!.summary!.title).toBe("Your September");
    expect(recap({ snapshot: seen("02", { ...september, month: "2026-08" }) }, "02")).toBeNull();
    const even = recap({ snapshot: seen("02", { ...september, income: 410_000 }) }, "02")!;
    expect(even.summary!.lines[0]!.value).toBe("$4,100 came in and $4,100 went out, so you kept $0");
  });

  it("stays quiet for a month Prism didn't hold whole, and for anyone who didn't ask for summaries", () => {
    expect(recap({ snapshot: seen("07", null) }, "07")).toBeNull();
    expect(emailFor(person({ kinds: ["bank"], snapshot: seen("02") }), at("02"))).toBeNull();
  });

  it("takes the place of a Monday summary on the same day, and once it has gone, a Monday has its own again", () => {
    const monday = recap({ snapshot: seen("05") }, "05")!;
    expect(monday.summary!.title).toBe("Your September");
    expect(monday.fingerprints).toEqual([fingerprint(U, "monthly:2026-09")]);
    const next = recap({ snapshot: seen("05"), sent: new Set(monday.fingerprints) }, "05")!;
    expect(next.summary!.title).toBe("Your week");
  });
});

describe("in Spanish, for someone who reads Prism in Spanish", () => {
  const es = translator("es");
  const september: MonthlyNumbers = {
    month: "2026-09",
    income: 582_000,
    spent: 410_000,
    before: { income: 560_000, spent: 440_000 },
    top: [
      { label: "Housing", spent: 195_000 },
      { label: "Food & dining", spent: 62_000 },
      { label: "Transport", spent: 41_000 },
    ],
    netWorth: { end: 8_420_000, change: 120_000 },
    ahead: { count: 9, total: 310_000 },
  };
  const recapOn = (day: string, over: Partial<Recipient> = {}) =>
    emailFor(person({ kinds: ["weekly"], snapshot: snapshot({ today: `2026-10-${day}`, at: `2026-10-${day}T12:00:00.000Z`, alerts: [], monthly: september }), ...over }), new Date(`2026-10-${day}T13:00:00Z`), es)!;

  it("says the Monday summary in Spanish, its dates in Spanish, and its amounts as a U.S. bank writes them", () => {
    const e = emailFor(person({ kinds: ["weekly"] }), MONDAY, es)!;
    expect(e.subject).toBe("Tu semana en Prism");
    expect(e.summary!.lines).toEqual([
      { label: "Gastado", value: "$840 del 27 sept al 3 oct, $40 más que la semana anterior" },
      { label: "Presupuestos", value: "$300 de $2,000 usados en lo que va del mes" },
      { label: "Patrimonio neto", value: "$12,500, subió $500 desde el cierre del mes pasado" },
      { label: "Lo que viene", value: "Oak Street Rent $1,800 el jue, 8 oct" },
    ]);
    // The same fingerprints in either language: a language changed between mornings never sends the same news twice.
    expect(e.fingerprints).toEqual(emailFor(person({ kinds: ["weekly"] }), MONDAY)!.fingerprints);
  });

  it("puts a change in words with a capital where it leads, and no dollar figure when amounts are off", () => {
    const e = emailFor(person({ kinds: ["weekly"], amounts: false }), MONDAY, es)!;
    expect(e.summary!.lines.map((l) => l.value)).toEqual([
      "Más que la semana anterior, del 27 sept al 3 oct",
      "15% usado en lo que va del mes",
      "Subió desde el cierre del mes pasado",
      "Oak Street Rent el jue, 8 oct",
    ]);
    const stale = emailFor(person({ kinds: ["weekly"], snapshot: snapshot({ today: "2026-09-20", at: "2026-09-20T12:00:00.000Z" }) }), MONDAY, es)!;
    expect(stale.summary!.note).toBe("Prism no ha revisado tus cuentas desde el dom, 20 sept, así que esta semana no hay cifras nuevas. Abre Prism y el resumen del próximo lunes las tendrá.");
  });

  it("sums up last month in Spanish, its categories by their Spanish names", () => {
    const e = recapOn("02");
    expect(e.subject).toBe("Tu mes de septiembre en Prism");
    expect(e.summary!.lines).toEqual([
      { label: "Entradas y salidas", value: "Entraron $5,820 y salieron $4,100, así que ahorraste $1,720" },
      { label: "Frente a agosto", value: "Gastaste $300 menos que en agosto" },
      { label: "A dónde se fue", value: "Vivienda $1,950, Comida $620, Transporte $410" },
      { label: "Patrimonio neto", value: "$84,200 al cierre de septiembre, subió $1,200 en el mes" },
      { label: "Lo que viene", value: "9 facturas en los próximos 30 días, unos $3,100 en total" },
    ]);
    expect(recapOn("02", { amounts: false }).summary!.lines.map((l) => l.value)).toEqual([
      "Ahorraste parte de lo que entró",
      "Gastaste menos que en agosto",
      "Vivienda, Comida y Transporte",
      "Subió en el mes",
      "9 facturas en los próximos 30 días",
    ]);
  });

  it("names a bank's trouble in Spanish, a bank Plaid gave no name as theirs, and says the same on the phone", () => {
    const banks = [
      { id: "item-1", name: "Your bank", attention: "sign-in" as const, since: null, disconnectAt: null },
      { id: "item-2", name: "First Bank", attention: "disconnecting" as const, since: null, disconnectAt: "2026-10-09T00:00:00Z" },
    ];
    const e = emailFor(person({ kinds: ["bank"], banks }), TUESDAY, es)!;
    expect(e.subject).toBe("Tu banco necesita que vuelvas a iniciar sesión, y 1 más");
    expect(e.items.map((i) => [i.title, i.detail])).toEqual([
      ["Tu banco necesita que vuelvas a iniciar sesión", "Hasta que lo hagas, Prism no puede ver nada nuevo de ese banco. Vuelve a iniciar sesión en Conexiones y continuará donde se quedó."],
      ["First Bank deja de actualizarse el vie, 9 oct", "A menos que vuelvas a iniciar sesión antes. Toma un minuto en Conexiones y no se pierde nada."],
    ]);
    expect(phoneAlertFor(e, es).body).toMatch(/ Y 1 más en el correo de hoy\.$/);
    expect(phoneAlertFor(recapOn("02"), es)).toEqual({ title: "Tu mes de septiembre en Prism", body: "Entradas y salidas: Entraron $5,820 y salieron $4,100, así que ahorraste $1,720", url: "/" });
  });
});
