// A filed return (tax-return.ts): its figures read from a 1040's text by the
// words on each line, never anything else on the page; checked before
// they're kept; and what they say beside this year.

import { describe, expect, it } from "vitest";
import { NO_DETAILS, validDetails, withTaxReturn } from "./details";
import { readReturn, returnFacts, validTaxReturn, type PageText, type TaxReturn } from "./tax-return";

/** A row of a page: each run of text at its x, all at one height. */
const row = (y: number, ...runs: [number, string][]): PageText[] => runs.map(([x, str]) => ({ x, y, str }));

/** The first two pages of a 2025 Form 1040 as a PDF's text layer lays them out, with the person's details in it. */
function form1040(): PageText[][] {
  return [
    [
      ...row(760, [36, "Form"], [60, "1040"], [110, "Department of the Treasury—Internal Revenue Service"]),
      ...row(748, [60, "U.S. Individual Income Tax Return"], [300, "2025"]),
      ...row(736, [36, "For the year Jan. 1–Dec. 31, 2025, or other tax year beginning"]),
      ...row(712, [36, "Your first name and middle initial"], [250, "Last name"], [470, "Your social security number"]),
      ...row(700, [36, "SAM"], [250, "RIVERA"], [470, "123-45-6789"]),
      ...row(676, [36, "Filing Status"], [100, "X"], [112, "Single"], [200, "Married filing jointly"], [330, "Married filing separately (MFS)"]),
      ...row(664, [112, "Head of household (HOH)"], [330, "Qualifying surviving spouse (QSS)"]),
      ...row(600, [36, "1a"], [60, "Total amount from Form(s) W-2, box 1 (see instructions)"], [470, "1a"], [530, "85,432."]),
      ...row(520, [36, "z"], [60, "Add lines 1a through 1h"], [470, "1z"], [530, "85,432."]),
      ...row(470, [36, "9"], [60, "Add lines 1z, 2b, 3b, 4b, 5b, 6b, 7, and 8. This is your total income"], [470, "9"], [530, "97,912."]),
      ...row(458, [36, "10"], [60, "Adjustments to income from Schedule 1, line 26"], [470, "10"], [530, "865."]),
      ...row(446, [36, "11"], [60, "Subtract line 10 from line 9. This is your adjusted gross income"], [470, "11"], [530, "97,047."]),
      ...row(410, [36, "15"], [60, "Subtract line 14 from line 11. If zero or less, enter -0-. This is your taxable income"], [470, "15"], [530, "82,047."]),
    ],
    [
      ...row(700, [36, "24"], [60, "Add lines 22 and 23. This is your total tax"], [470, "24"], [530, "12,488."]),
      ...row(680, [36, "d"], [60, "Add lines 25a through 25c"], [470, "25d"], [530, "11,200."]),
      ...row(668, [36, "26"], [60, "2025 estimated tax payments and amount applied from 2024 return"], [470, "26"], [530, "2,000."]),
      ...row(620, [36, "33"], [60, "Add lines 25d, 26, and 32. These are your total payments"], [470, "33"], [530, "13,200."]),
      ...row(600, [36, "34"], [60, "If line 33 is more than line 24, subtract line 24 from line 33. This is the amount you overpaid"], [470, "34"], [530, "712."]),
      ...row(588, [36, "35a"], [60, "Amount of line 34 you want refunded to you. If Form 8888 is attached, check here"], [470, "35a"], [530, "712."]),
      ...row(576, [36, "b"], [60, "Routing number"], [150, "021000021"], [300, "c Type:"], [340, "X"], [352, "Checking"]),
      ...row(564, [36, "d"], [60, "Account number"], [150, "000123456789"]),
      ...row(530, [36, "37"], [60, "Subtract line 33 from line 24. This is the amount you owe."], [470, "37"]),
    ],
    [...row(700, [36, "3"], [60, "Business income or (loss). Attach Schedule C"], [470, "3"], [530, "12,480."])],
  ];
}

describe("reading a 1040", () => {
  it("finds each figure by the words on its line, and the year and filing status from the form", () => {
    const r = readReturn(form1040());
    expect(r.found).toBe(true);
    expect(r.year).toBe(2025);
    expect(r.status).toBe("single");
    expect(r.figures).toEqual({
      wages: 8_543_200,
      business: 1_248_000,
      totalIncome: 9_791_200,
      agi: 9_704_700,
      taxable: 8_204_700,
      totalTax: 1_248_800,
      withheld: 1_120_000,
      estimated: 200_000,
      payments: 1_320_000,
      refund: 71_200,
      // The line number beside an empty amount is never read as one.
      owed: null,
    });
  });

  it("keeps nothing but the figures: no name, number or bank detail from the page", () => {
    const kept = JSON.stringify(readReturn(form1040()));
    for (const secret of ["SAM", "RIVERA", "123-45-6789", "021000021", "000123456789"]) expect(kept).not.toContain(secret);
  });

  it("reads an amount printed a row below its words, a loss, and cents", () => {
    const r = readReturn([
      [
        ...row(500, [60, "Subtract line 10 from line 9. This is your adjusted gross income"], [470, "11"]),
        ...row(490, [530, "48,210.50"]),
        ...row(400, [60, "Business income or (loss). Attach Schedule C"], [470, "3"], [530, "(2,300)"]),
      ],
    ]);
    expect(r.figures.agi).toBe(4_821_050);
    expect(r.figures.business).toBe(-230_000);
  });

  it("says when a file isn't a 1040", () => {
    const r = readReturn([[...row(700, [36, "Statement of account"], [400, "Balance"], [500, "1,234.00"])]]);
    expect(r).toMatchObject({ found: false, year: null, status: null });
  });

  it("reads a ticked married-filing-jointly box, and the first page with a line wins", () => {
    const pages = form1040();
    pages[0] = pages[0]!.map((p) => (p.str === "X" && p.y === 676 ? { ...p, x: 188 } : p));
    // A state return further on, with its own "total tax", never overrides the federal one.
    pages.push(row(700, [60, "This is your total tax"], [530, "3,100."]));
    const r = readReturn(pages);
    expect(r.status).toBe("joint");
    expect(r.figures.totalTax).toBe(1_248_800);
  });
});

describe("keeping a return", () => {
  const base: TaxReturn = { year: 2025, status: "single", wages: 8_543_200, business: null, totalIncome: null, agi: 9_704_700, taxable: null, totalTax: 1_248_800, withheld: null, estimated: null, payments: null, refund: 71_200, owed: null };

  it("keeps only what reads, and only a return worth comparing against", () => {
    expect(validTaxReturn(base, 2026)).toEqual(base);
    expect(validTaxReturn({ ...base, year: 2027 }, 2026)).toBeNull();
    expect(validTaxReturn({ ...base, status: "married" }, 2026)).toBeNull();
    expect(validTaxReturn({ ...base, refund: -5 }, 2026)).toBeNull();
    expect(validTaxReturn({ ...base, agi: 1.5 }, 2026)).toBeNull();
    expect(validTaxReturn({ ...base, business: -400_000 }, 2026)?.business).toBe(-400_000);
    expect(validTaxReturn({ ...base, agi: null, totalTax: null }, 2026)).toBeNull();
  });

  it("is sealed with the details by year, and removed by year", () => {
    let d = withTaxReturn(NO_DETAILS, 2025, base);
    d = withTaxReturn(d, 2024, { ...base, year: 2024 });
    d = validDetails(JSON.parse(JSON.stringify(d)));
    expect(Object.keys(d.returns!).sort()).toEqual(["2024", "2025"]);
    // A return stored under another year's key is dropped, never moved.
    expect(validDetails({ v: 1, lines: {}, returns: { "2023": base } }).returns).toBeUndefined();
    expect(withTaxReturn(d, 2024, null).returns).toEqual({ "2025": base });
  });
});

describe("what a return says beside this year", () => {
  const r: TaxReturn = { year: 2025, status: "single", wages: null, business: null, totalIncome: null, agi: 9_704_700, taxable: null, totalTax: 1_248_800, withheld: null, estimated: null, payments: null, refund: 71_200, owed: null };

  it("gives the effective rate, the refund, and the safe-harbor amount at 100% or 110%", () => {
    const f = returnFacts(r);
    expect(f.effectiveRate).toBeCloseTo(0.1287, 4);
    expect(f.settled).toBe(71_200);
    expect(f.safeHarbor).toEqual({ amount: 1_248_800, share: 1 });
    expect(returnFacts({ ...r, agi: 20_000_000 }).safeHarbor).toEqual({ amount: 1_373_680, share: 1.1 });
    // Married filing separately, the line is $75,000.
    expect(returnFacts({ ...r, status: "separate", agi: 8_000_000 }).safeHarbor?.share).toBe(1.1);
    expect(returnFacts({ ...r, refund: null, owed: 50_000 }).settled).toBe(-50_000);
    expect(returnFacts({ ...r, totalTax: 0 }).safeHarbor).toBeNull();
  });
});
