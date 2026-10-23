// A change notice: shown from the day it's published until a month past its
// change, newest first; its words carry the plan's real prices in both
// languages; and live Stripe keys sell nothing before Prism Plus's day.

import { describe, expect, it } from "vitest";
import { PRICES, priceLabel, TRIAL_DAYS } from "@/lib/billing/plans";
import { translator } from "@/lib/i18n/translator";
import { currentNotice, fullDate, inEffect, liveSalesOpen, noticeById, NOTICES, noticeWords, PLUS_STARTS, type ChangeNotice } from "./legal-notice";

const plus = noticeById("plus-2026-11")!;

describe("which notice shows", () => {
  it("shows from its publishing day until 30 days past its change, and nothing outside that", () => {
    expect(currentNotice("2026-10-22")).toBeNull();
    expect(currentNotice("2026-10-23")?.id).toBe("plus-2026-11");
    expect(currentNotice("2026-12-23")?.id).toBe("plus-2026-11");
    expect(currentNotice("2026-12-24")).toBeNull();
  });

  it("shows the newest of two that overlap", () => {
    const later: ChangeNotice = { ...plus, id: "later", published: "2026-11-01", effective: "2026-12-01" };
    expect(currentNotice("2026-11-02", [plus, later])?.id).toBe("later");
    expect(currentNotice("2026-10-30", [plus, later])?.id).toBe("plus-2026-11");
  });

  it("knows a notice only by an id it has, written as the database accepts", () => {
    expect(new Set(NOTICES.map((n) => n.id)).size).toBe(NOTICES.length);
    for (const n of NOTICES) {
      expect(n.id).toMatch(/^[a-z0-9-]{1,40}$/);
      expect(n.published < n.effective).toBe(true);
    }
    expect(noticeById("PLUS-2026-11")).toBeNull();
    expect(noticeById(undefined)).toBeNull();
  });

  it("says in the past tense once the change has happened", () => {
    expect(inEffect(plus, "2026-11-22")).toBe(false);
    expect(inEffect(plus, "2026-11-23")).toBe(true);
  });
});

describe("a notice's words", () => {
  it("names the plan's real prices, trial and date, in English and Spanish", () => {
    for (const locale of ["en", "es"] as const) {
      const t = translator(locale);
      const { title, points } = noticeWords(plus, t);
      const all = [title, ...points].join(" ");
      expect(title).toContain(fullDate(PLUS_STARTS, locale));
      for (const cents of [PRICES.plus.month, PRICES.plus.year, PRICES.household.month, PRICES.household.year]) expect(all).toContain(priceLabel(cents));
      expect(all).toContain(String(TRIAL_DAYS));
      expect(all).not.toMatch(/\{\w+\}/);
    }
    expect(fullDate("2026-11-23", "en")).toBe("November 23, 2026");
    expect(fullDate("2026-11-23", "es")).toBe("23 de noviembre de 2026");
  });
});

describe("live sales", () => {
  it("open at midnight in Texas on the day every account was told", () => {
    expect(liveSalesOpen(new Date("2026-11-23T05:59:59Z"))).toBe(false);
    expect(liveSalesOpen(new Date("2026-11-23T06:00:00Z"))).toBe(true);
  });
});
