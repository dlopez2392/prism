// Venmo, PayPal and Cash App files as each app writes them, read and matched
// to the bank lines they caused: who each payment was for, never a guess.

import { describe, expect, it } from "vitest";
import {
  appOf,
  applyP2pNotes,
  combineP2pFiles,
  cleanText,
  matchP2p,
  mergeP2pNotes,
  NO_P2P_NOTES,
  P2P_LIMITS,
  p2pLabel,
  readP2pFile,
  validP2pMatch,
  validP2pNotes,
  type BankLine,
  type P2pNote,
} from "./p2p";
import type { Transaction } from "./types";

// As Venmo writes it: a title, a balance line, the payments, and a closing summary with a disclaimer.
const VENMO = [
  "Account Statement - (@Dan-Lopez) ,,,,,,,,,,,,,,,,,,,,,",
  "Account Activity,,,,,,,,,,,,,,,,,,,,,",
  ",ID,Datetime,Type,Status,Note,From,To,Amount (total),Amount (tip),Amount (tax),Amount (fee),Tax Rate,Tax Exempt,Funding Source,Destination,Beginning Balance,Ending Balance,Statement Period Venmo Fees,Terminal Location,Year to Date Venmo Fees,Disclaimer",
  ",,,,,,,,,,,,,,,,$12.00,,,,,",
  ",4012,2026-09-12T02:15:00,Payment,Complete,pizza 🍕,Dan Lopez,Alex Kim,- $45.00,,0,,0,,Chase Checking,,,,,Venmo,,",
  ",4013,2026-09-13T18:00:00,Payment,Complete,rent split,Sam Lee,Dan Lopez,+ $600.00,,0,,0,,,Venmo balance,,,,Venmo,,",
  ",4014,2026-09-14T18:00:00,Charge,Complete,concert tix,Jo Park,Dan Lopez,- $80.00,,0,,0,,Venmo balance,,,,,Venmo,,",
  ",4015,2026-09-15T12:00:00,Standard Transfer,Issued,,Dan Lopez,,- $500.00,,,,,,,Chase Checking *1234,,,,Venmo,,",
  ",4016,2026-09-16T12:00:00,Instant Transfer,Issued,,Dan Lopez,,- $100.00,,,- $1.75,,,,Chase Checking *1234,,,,Venmo,,",
  ",4017,2026-09-17T12:00:00,Payment,Pending,lunch,Dan Lopez,Alex Kim,- $12.00,,,,,,Chase Checking,,,,,Venmo,,",
  ',4018,2026-09-18T12:00:00,Charge,Complete,"gas, tolls",Jo Park,Dan Lopez,- $30.00,,,,,,Chase Checking,,,,,Venmo,,',
  ',,,,,,,,,,,,,,,,,$100.00,$0.00,,$0.00,"Venmo is a service of PayPal, Inc."',
].join("\n");

const CASH_APP = [
  "Transaction ID,Date,Transaction Type,Currency,Amount,Fee,Net Amount,Asset Type,Asset Price,Asset Amount,Status,Notes,Name of sender/receiver,Account",
  "abc1,2026-09-10 20:15:00 EDT,P2P,USD,-$25.00,$0,-$25.00,,,,PAYMENT SENT,tacos,Maria Gomez,Visa Debit 4321",
  "abc2,2026-09-11 09:00:00 EDT,P2P,USD,$40.00,$0,$40.00,,,,PAYMENT DEPOSITED,gas money,Luis R,Your Cash",
  "abc3,2026-09-12 09:00:00 EDT,Cash Card Debit,USD,-$9.99,$0,-$9.99,,,,CARD CHARGED,,Spotify,Cash Card",
  "abc4,2026-09-13 09:00:00 EDT,Cash out,USD,-$200.00,-$3.00,-$197.00,,,,COMPLETE,,,Visa Debit 4321",
  "abc5,2026-09-14 09:00:00 EDT,P2P,USD,-$15.00,$0,-$15.00,,,,CANCELED,,Maria Gomez,Visa Debit 4321",
].join("\n");

const PAYPAL = [
  '"Date","Time","TimeZone","Name","Type","Status","Currency","Gross","Fee","Net","From Email Address","To Email Address","Transaction ID","Subject","Note","Balance Impact"',
  '"09/05/2026","10:00:00","PDT","Chris Doe","General Payment","Completed","USD","-60.00","0.00","-60.00","dan@example.com","chris@example.com","1AB","","dinner","Debit"',
  '"09/05/2026","10:00:00","PDT","Chase Bank","Bank Deposit to PP Account ","Completed","USD","60.00","0.00","60.00","","dan@example.com","1AC","","","Credit"',
  '"09/06/2026","11:30:00","PDT","Etsy Shop","Express Checkout Payment","Completed","USD","-23.50","0.00","-23.50","dan@example.com","shop@example.com","1AD","","","Debit"',
  '"09/07/2026","08:00:00","PDT","Jane Roe","General Payment","Completed","USD","20.00","0.00","20.00","jane@example.com","dan@example.com","1AE","","coffee","Credit"',
  '"09/08/2026","08:00:00","PDT","","General Withdrawal","Completed","USD","-100.00","0.00","-100.00","","","1AF","","","Debit"',
  '"09/09/2026","08:00:00","PDT","Bob","General Payment","Completed","EUR","-10.00","0.00","-10.00","","","1AG","","","Debit"',
  '"09/10/2026","08:00:00","PDT","Kim","General Payment","Pending","USD","-5.00","0.00","-5.00","","","1AH","","","Debit"',
].join("\n");

const line = (id: string, date: string, amount: number, merchant: string): BankLine => ({ id, date, amount, merchant });

describe("reading each app's file", () => {
  it("reads Venmo: who, the note, which way, and what the bank would show", () => {
    const f = readP2pFile(VENMO)!;
    expect(f.app).toBe("venmo");
    // The balance line, the pending payment and the closing summary.
    expect(f.skipped).toBe(3);
    expect(f.rows.map((r) => [r.dir, r.name, r.note, r.amount, r.bank])).toEqual([
      ["to", "Alex Kim", "pizza 🍕", -4500, [-4500]],
      // Received into the Venmo balance, and a charge paid from it: the bank never sees either.
      ["from", "Sam Lee", "rent split", 60000, []],
      ["to", "Jo Park", "concert tix", -8000, []],
      ["transfer", "Moved to your bank", null, -50000, [50000]],
      // An instant transfer lands less its fee.
      ["transfer", "Moved to your bank", null, -10000, [10000, 9825]],
      // Jo charged Dan, and Dan paid from his bank: the payment was to Jo.
      ["to", "Jo Park", "gas, tolls", -3000, [-3000]],
    ]);
    expect(f.rows[0]!.date).toBe("2026-09-12");
  });

  it("reads Cash App, leaving out card purchases and cancelled payments", () => {
    const f = readP2pFile(CASH_APP)!;
    expect(f.app).toBe("cashapp");
    expect(f.skipped).toBe(2);
    expect(f.rows.map((r) => [r.dir, r.name, r.note, r.bank])).toEqual([
      ["to", "Maria Gomez", "tacos", [-2500]],
      ["from", "Luis R", "gas money", []],
      ["transfer", "Moved to your bank", null, [20000, 19700]],
    ]);
  });

  it("reads PayPal, skipping the bank top-ups, other currencies and pending payments", () => {
    const f = readP2pFile(PAYPAL)!;
    expect(f.app).toBe("paypal");
    expect(f.skipped).toBe(3);
    expect(f.rows.map((r) => [r.dir, r.name, r.note, r.bank])).toEqual([
      ["to", "Chris Doe", "dinner", [-6000]],
      ["to", "Etsy Shop", null, [-2350]],
      ["from", "Jane Roe", "coffee", []],
      ["transfer", "Moved to your bank", null, [10000]],
    ]);
  });

  it("reads a PayPal file that says Amount and Subject instead of Gross and Note", () => {
    const f = readP2pFile(['"Date","Time","TimeZone","Name","Type","Status","Currency","Amount","Subject"', '"09/05/2026","10:00:00","PDT","Chris Doe","Mobile Payment","Completed","USD","-60.00","dinner"'].join("\n"))!;
    expect(f.rows).toMatchObject([{ app: "paypal", name: "Chris Doe", note: "dinner", bank: [-6000] }]);
  });

  it("says plainly when a file isn't one of the three", () => {
    expect(readP2pFile("Date,Description,Original Description,Amount,Transaction Type,Category,Account Name\n1/2/2024,Coffee,COFFEE,4.50,debit,Coffee Shops,Checking")).toBeNull();
    expect(readP2pFile("")).toBeNull();
    expect(readP2pFile("hello world")).toBeNull();
  });
});

describe("several files at once", () => {
  it("counts a payment two overlapping files share once, but keeps two identical payments in one file", () => {
    const [a, b] = readP2pFile(VENMO)!.rows;
    const twice = { ...a! };
    expect(combineP2pFiles([[a!, b!], [a!]])).toHaveLength(2);
    expect(combineP2pFiles([[a!, twice], [a!]])).toHaveLength(2);
    expect(combineP2pFiles([[a!], [a!, twice]])).toHaveLength(2);
    expect(combineP2pFiles([[a!], [b!]])).toHaveLength(2);
    expect(combineP2pFiles([])).toEqual([]);
  });
});

describe("matching to the bank", () => {
  it("pairs each payment with the line it caused, by app, amount and posting lag", () => {
    const rows = readP2pFile(VENMO)!.rows;
    const lines = [
      line("v1", "2026-09-13", -4500, "Venmo"),
      line("v2", "2026-09-16", 50000, "VENMO CASHOUT"),
      line("v3", "2026-09-17", 9825, "Venmo"),
      line("v4", "2026-09-19", -3000, "VENMO *JO PARK"),
      // Same amount, not Venmo; and Venmo, but weeks before.
      line("x1", "2026-09-13", -4500, "Starbucks"),
      line("x2", "2026-08-01", -4500, "Venmo"),
    ];
    const r = matchP2p(rows, lines);
    expect(r.matches.map((m) => [m.txnId, p2pLabel(m), m.note])).toEqual([
      ["v4", "To Jo Park", "gas, tolls"],
      ["v3", "Moved to your bank", null],
      ["v2", "Moved to your bank", null],
      ["v1", "To Alex Kim", "pizza 🍕"],
    ]);
    expect(r).toMatchObject({ inApp: 2, unmatched: 0, from: "2026-09-12", to: "2026-09-18" });
  });

  it("matches Cash App and PayPal lines by their own descriptors", () => {
    const cash = matchP2p(readP2pFile(CASH_APP)!.rows, [line("c1", "2026-09-11", -2500, "Cash App*Maria Gomez"), line("c2", "2026-09-14", 19700, "Square Cash")]);
    expect(cash.matches.map((m) => [m.txnId, m.name])).toEqual([
      ["c2", "Moved to your bank"],
      ["c1", "Maria Gomez"],
    ]);
    const pp = matchP2p(readP2pFile(PAYPAL)!.rows, [line("p1", "2026-09-06", -6000, "PAYPAL INST XFER"), line("p2", "2026-09-07", -2350, "PayPal"), line("p3", "2026-09-09", 10000, "PAYPAL TRANSFER")]);
    expect(pp.matches.map((m) => [m.txnId, p2pLabel(m)])).toEqual([
      ["p3", "Moved to your bank"],
      ["p2", "To Etsy Shop"],
      ["p1", "To Chris Doe"],
    ]);
  });

  it("never pairs a line with another app's payment, and counts what found no line", () => {
    const r = matchP2p(readP2pFile(CASH_APP)!.rows, [line("v", "2026-09-11", -2500, "Venmo")]);
    expect(r.matches).toEqual([]);
    expect(r).toMatchObject({ inApp: 1, unmatched: 2 });
  });

  it("keeps to the window: a day before the app's date to five days after", () => {
    const rows = readP2pFile(VENMO)!.rows.slice(0, 1); // −$45.00 on Sep 12
    const at = (date: string) => matchP2p(rows, [line("v", date, -4500, "Venmo")]).matches.length;
    expect([at("2026-09-10"), at("2026-09-11"), at("2026-09-17"), at("2026-09-18")]).toEqual([0, 1, 1, 0]);
  });

  it("pairs the closest dates first, so two identical payments a week apart never swap", () => {
    const file = [
      ",ID,Datetime,Type,Status,Note,From,To,Amount (total),Funding Source,Destination",
      ",1,2026-09-01T12:00:00,Payment,Complete,week one,Dan,Alex,- $20.00,Chase,",
      ",2,2026-09-05T12:00:00,Payment,Complete,week two,Dan,Sam,- $20.00,Chase,",
    ].join("\n");
    const r = matchP2p(readP2pFile(file)!.rows, [line("b", "2026-09-06", -2000, "Venmo"), line("a", "2026-09-02", -2000, "Venmo")]);
    expect(Object.fromEntries(r.matches.map((m) => [m.txnId, m.note]))).toEqual({ a: "week one", b: "week two" });
  });

  it("lets a later payment keep the line dated on its own day, rather than the earlier payment taking it", () => {
    const file = [
      ",ID,Datetime,Type,Status,Note,From,To,Amount (total),Funding Source,Destination",
      ",1,2026-09-01T12:00:00,Payment,Complete,first,Dan,Alex,- $20.00,Chase,",
      ",2,2026-09-05T12:00:00,Payment,Complete,second,Dan,Sam,- $20.00,Chase,",
    ].join("\n");
    // "a" is four days after the first payment but the very day of the second; "b" is the day after the first, and too early for the second.
    const r = matchP2p(readP2pFile(file)!.rows, [line("a", "2026-09-05", -2000, "Venmo"), line("b", "2026-09-02", -2000, "Venmo")]);
    expect(Object.fromEntries(r.matches.map((m) => [m.txnId, m.note]))).toEqual({ a: "second", b: "first" });
  });

  it("never puts two payments on one line", () => {
    const file = [
      ",ID,Datetime,Type,Status,Note,From,To,Amount (total),Funding Source,Destination",
      ",1,2026-09-01T12:00:00,Payment,Complete,one,Dan,Alex,- $20.00,Chase,",
      ",2,2026-09-02T12:00:00,Payment,Complete,two,Dan,Sam,- $20.00,Chase,",
    ].join("\n");
    const r = matchP2p(readP2pFile(file)!.rows, [line("a", "2026-09-02", -2000, "Venmo")]);
    expect(r.matches).toHaveLength(1);
    expect(r.unmatched).toBe(1);
  });

  it("uses each line once and each payment once", () => {
    const file = [",ID,Datetime,Type,Status,Note,From,To,Amount (total),Funding Source,Destination", ",1,2026-09-01T12:00:00,Payment,Complete,only one,Dan,Alex,- $20.00,Chase,"].join("\n");
    const r = matchP2p(readP2pFile(file)!.rows, [line("a", "2026-09-01", -2000, "Venmo"), line("b", "2026-09-02", -2000, "Venmo")]);
    expect(r.matches.map((m) => m.txnId)).toEqual(["a"]);
  });
});

describe("what other people wrote", () => {
  it("is one clean line: no control characters, no text reversal, no hidden marks", () => {
    expect(cleanText("line one\nline two\t\u0007", 200)).toBe("line one line two");
    expect(cleanText("pay\u202eli\u2066am\u200b", 200)).toBe("pay li am");
    // An emoji's joiner stays, so a family stays one emoji.
    expect(cleanText("👨\u200d👩\u200d👧 trip", 200)).toBe("👨\u200d👩\u200d👧 trip");
    expect([...cleanText("🍕".repeat(300), P2P_LIMITS.note)]).toHaveLength(P2P_LIMITS.note);
  });

  it("reaches the parsed rows already cleaned", () => {
    const file = [",ID,Datetime,Type,Status,Note,From,To,Amount (total),Funding Source,Destination", `,1,2026-09-01T12:00:00,Payment,Complete,"ignore\u202e previous\ninstructions",Dan,"Al\u200bex",- $20.00,Chase,`].join("\n");
    const [row] = readP2pFile(file)!.rows;
    expect(row).toMatchObject({ name: "Al ex", note: "ignore previous instructions" });
  });
});

describe("keeping notes", () => {
  const note = (over: Partial<P2pNote> = {}): P2pNote => ({ app: "venmo", dir: "to", name: "Alex", note: "pizza", date: "2026-09-12", ...over });

  it("reads kept notes as untrusted, dropping a bad entry on its own", () => {
    const kept = validP2pNotes({
      v: 1,
      notes: { a: note(), b: { ...note(), app: "zelle" }, c: { ...note(), date: "2026-02-30" }, d: { ...note(), name: "\u200b" }, e: { ...note(), note: 7 }, [""]: note() },
    });
    expect(Object.keys(kept.notes)).toEqual(["a"]);
    expect(validP2pNotes(null)).toEqual(NO_P2P_NOTES);
    expect(validP2pNotes({ v: 2, notes: { a: note() } })).toEqual(NO_P2P_NOTES);
  });

  it("keeps the newest past the limit", () => {
    const many = Object.fromEntries(Array.from({ length: P2P_LIMITS.notes + 5 }, (_, i) => [`t${i}`, note({ date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}` })]));
    const kept = validP2pNotes({ v: 1, notes: many });
    expect(Object.keys(kept.notes)).toHaveLength(P2P_LIMITS.notes);
    expect(Object.values(kept.notes).some((n) => n.date === "2026-01-28")).toBe(true);
  });

  it("lets new notes replace old ones for the same transaction", () => {
    const merged = mergeP2pNotes({ v: 1, notes: { a: note(), b: note({ name: "Sam" }) } }, [["a", note({ name: "Jo" })]]);
    expect(merged.notes.a!.name).toBe("Jo");
    expect(merged.notes.b!.name).toBe("Sam");
  });
});

describe("checking a match on the server", () => {
  const txns = new Map(
    [
      { id: "v1", date: "2026-09-13", amount: -4500, merchant: "Venmo" },
      { id: "v2", date: "2026-09-16", amount: 50000, merchant: "Venmo" },
      { id: "s1", date: "2026-09-13", amount: -4500, merchant: "Starbucks" },
    ].map((t) => [t.id, t]),
  );
  const match = { txnId: "v1", app: "venmo", dir: "to", name: "Alex Kim", note: "pizza", date: "2026-09-12" };

  it("accepts a match on the person's own line from that app, in the window, the right way round", () => {
    expect(validP2pMatch(match, txns)).toEqual(["v1", { app: "venmo", dir: "to", name: "Alex Kim", note: "pizza", date: "2026-09-12" }]);
    expect(validP2pMatch({ ...match, txnId: "v2", dir: "transfer", name: "Moved to your bank", note: null, date: "2026-09-15" }, txns)).not.toBeNull();
  });

  it("refuses a line that isn't theirs, isn't that app's, is outside the window, or goes the wrong way", () => {
    expect(validP2pMatch({ ...match, txnId: "someone-else" }, txns)).toBeNull();
    expect(validP2pMatch({ ...match, txnId: "s1" }, txns)).toBeNull();
    expect(validP2pMatch({ ...match, app: "paypal" }, txns)).toBeNull();
    expect(validP2pMatch({ ...match, date: "2026-09-01" }, txns)).toBeNull();
    expect(validP2pMatch({ ...match, date: "2026-09-15" }, txns)).toBeNull();
    expect(validP2pMatch({ ...match, dir: "from" }, txns)).toBeNull();
    expect(validP2pMatch({ ...match, txnId: "v2", date: "2026-09-15" }, txns)).toBeNull();
    expect(validP2pMatch("v1", txns)).toBeNull();
  });

  it("cleans what it keeps, whatever the browser sent", () => {
    expect(validP2pMatch({ ...match, name: `Alex\u202e${"x".repeat(500)}`, note: "a\nb" }, txns)![1]).toMatchObject({ name: `Alex ${"x".repeat(P2P_LIMITS.name - 5)}`, note: "a b" });
  });
});

describe("applying notes", () => {
  it("adds who each payment was for, and never changes the transactions it's given", () => {
    const txns: Transaction[] = [
      { id: "v1", accountId: "chk", date: "2026-09-13", amount: -4500, merchant: "Venmo", category: "transfer", pending: false },
      { id: "x", accountId: "chk", date: "2026-09-13", amount: -900, merchant: "Cafe", category: "food", pending: false },
    ];
    const before = structuredClone(txns);
    const out = applyP2pNotes(txns, { v: 1, notes: { v1: { app: "venmo", dir: "to", name: "Alex", note: "pizza", date: "2026-09-12" } } });
    expect(out[0]!.p2p).toMatchObject({ name: "Alex" });
    expect(out[1]).toBe(txns[1]);
    expect(txns).toEqual(before);
    expect(applyP2pNotes(txns, NO_P2P_NOTES)).toBe(txns);
  });

  it("knows each app's bank descriptors", () => {
    expect(["VENMO *ALEX", "Venmo", "PAYPAL INST XFER", "PYPL PAYIN4", "Cash App*Alex", "SQ *CASH APP", "Square Cash", "Starbucks", "Venmont Diner"].map(appOf)).toEqual([
      "venmo",
      "venmo",
      "paypal",
      "paypal",
      "cashapp",
      "cashapp",
      "cashapp",
      null,
      null,
    ]);
  });
});
