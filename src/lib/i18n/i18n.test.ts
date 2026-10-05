// Prism in Spanish (lib/i18n): which language a visit gets, how a sentence
// is looked up and filled in, how dates read, and that every sentence the
// code asks to translate has its Spanish.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dayDate, dayRange, monthLong, monthYear, shortDate } from "@/lib/finance/format";
import { ES, ES_PARTS } from "./es";
import { englishOnly, pickLocale } from "./locale";
import { translator } from "./translator";

describe("which language a visit gets", () => {
  it("is the person's own pick, whatever the browser says", () => {
    expect(pickLocale("es", "en-US,en;q=0.9")).toBe("es");
    expect(pickLocale("en", "es-MX,es;q=0.9")).toBe("en");
  });

  it("is Spanish, until they pick, when the browser asks for Spanish first", () => {
    expect(pickLocale(undefined, "es-MX,es;q=0.9,en;q=0.8")).toBe("es");
    expect(pickLocale(undefined, "en;q=0.5, es;q=0.9")).toBe("es");
    expect(pickLocale(undefined, "en-US,en;q=0.9,es;q=0.8")).toBe("en");
    expect(pickLocale("fr", null)).toBe("en");
    expect(pickLocale(undefined, "es;q=0")).toBe("en");
  });
});

describe("screens still only in English", () => {
  it("are the ones listed, and everything under them, and no other", () => {
    expect(englishOnly("/connections")).toBe(true);
    expect(englishOnly("/connections/amazon")).toBe(true);
    expect(englishOnly("/goals")).toBe(false);
    expect(englishOnly("/")).toBe(false);
    expect(englishOnly("/spending")).toBe(false);
    expect(englishOnly("/sign-in/two-step")).toBe(false);
    // A prefix of a name is not the screen.
    expect(englishOnly("/connectionsx")).toBe(false);
  });
});

describe("a sentence", () => {
  it("is itself in English, its Spanish in Spanish, and fills in what it's given by name", () => {
    expect(translator("en")("Spent this month")).toBe("Spent this month");
    expect(translator("es")("Spent this month")).toBe(ES["Spent this month"]);
    expect(translator("en")("Spent over {n} months", { n: 3 })).toBe("Spent over 3 months");
    expect(translator("es")("Spent over {n} months", { n: 3 })).toBe("Gastado en {n} meses".replace("{n}", "3"));
  });

  it("stays English rather than showing a key when its Spanish is missing, and leaves a name it wasn't given", () => {
    expect(translator("es")("A sentence nobody translated")).toBe("A sentence nobody translated");
    expect(translator("en")("Hello {who}", {})).toBe("Hello {who}");
  });
});

describe("dates in Spanish", () => {
  it("put the day before the month, in lower case", () => {
    expect(shortDate("2026-09-27", "es")).toBe("27 sept");
    expect(dayDate("2026-10-05", "es")).toBe("lun, 5 oct");
    expect(monthYear("2026-10-05", "es")).toBe("oct 2026");
    expect(monthLong("2026-01-05", "es")).toBe("enero");
    expect(dayRange("2026-09-01", "2026-09-05", "es")).toBe("1–5 sept");
    expect(dayRange("2026-09-28", "2026-10-03", "es")).toBe("28 sept – 3 oct");
    // English is as it was.
    expect(dayRange("2026-09-01", "2026-09-05")).toBe("Sep 1 – 5");
  });
});

/** Every sentence handed to t() as a literal, across the app. */
function askedFor(): string[] {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        const text = readFileSync(path, "utf8");
        // t("…") and tr("…") translate where they're written; msg("…") marks one translated where it's shown.
        for (const m of text.matchAll(/\b(?:t|tr|msg)\(\s*"((?:[^"\\]|\\.)*)"/g)) out.add(JSON.parse(`"${m[1]}"`));
      }
    }
  };
  walk(join(process.cwd(), "src"));
  return [...out].sort();
}

describe("the Spanish", () => {
  it("has every sentence the code asks to translate", () => {
    const missing = askedFor().filter((s) => !Object.hasOwn(ES, s));
    expect(missing).toEqual([]);
  });

  it("keeps every name a sentence fills in, and asks for none it isn't given", () => {
    // "{Month}" is "{month}" with a capital (t.ts), so names compare without their case.
    const names = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!.toLowerCase()))].sort();
    for (const [en, es] of Object.entries(ES)) expect(names(es), en).toEqual(names(en));
  });

  it("gives each sentence once, in one part", () => {
    const seen = new Map<string, string>();
    const twice: string[] = [];
    for (const [part, words] of Object.entries(ES_PARTS)) {
      for (const en of Object.keys(words)) {
        if (seen.has(en)) twice.push(`${en} (${seen.get(en)}, ${part})`);
        else seen.set(en, part);
      }
    }
    expect(twice).toEqual([]);
  });

  it("has nothing it isn't asked for", () => {
    const asked = new Set(askedFor());
    expect(Object.keys(ES).filter((s) => !asked.has(s))).toEqual([]);
  });
});
