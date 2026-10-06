// The privacy policy and the Terms in Spanish (legal-languages.ts): held
// until a lawyer approves each against the English in force, and kept in
// step with the English, which governs, until then and after. The English
// can't change without its Spanish, the Spanish says what the English says
// under every combination of the operator's switches, and nobody reads it
// before it's approved.

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivacyPolicy } from "@/app/privacy/policy-en";
import { PoliticaDePrivacidad } from "@/app/privacy/policy-es";
import { TermsOfService } from "@/app/terms/terms-en";
import { TerminosDelServicio } from "@/app/terms/terms-es";
import { ENGLISH_ONLY } from "@/lib/i18n/locale";
import { listEs, longDateEs, PRIVACY_LISTS_ES } from "./legal-es";
import { approvedFor, LEGAL_PATHS, SPANISH_TRANSLATED_FROM, spanishPublished, type LegalPage } from "./legal-languages";
import { ALCHEMY, MEMPOOL, POLICY_UPDATED, PROVIDERS, PUSH_SERVICES, RENTCAST, RESEND_WITH_ALERTS, STORED_ON_DEVICE, STRIPE, type PrivacySwitches } from "./privacy";
import { TERMS_UPDATED } from "./terms";

vi.mock("server-only", () => ({}));

/** Every combination of the switches the policy's words follow. */
const SWITCHES: PrivacySwitches[] = Array.from({ length: 32 }, (_, n) => ({
  liabilities: (n & 1) > 0,
  homeValues: (n & 2) > 0,
  alchemy: (n & 4) > 0,
  alerts: (n & 8) > 0,
  billing: (n & 16) > 0,
}));

/** A page's shape: each section's anchor, with how many paragraphs and list items it has and where its links go. */
function shape(html: string) {
  return [...html.matchAll(/<section id="([^"]+)"[\s\S]*?<\/section>/g)].map(([whole, id]) => ({
    id,
    paragraphs: whole.match(/<p[\s>]/g)?.length ?? 0,
    items: whole.match(/<li[\s>]/g)?.length ?? 0,
    links: [...whole.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).sort(),
  }));
}

/** The words a reader sees: no markup, no addresses, no cookie names. */
function words(html: string): string {
  return html
    .replace(/<code[\s\S]*?<\/code>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+|\S+@\S+/g, " ")
    .replace(/&[a-z#0-9]+;/g, " ");
}

describe("the Spanish legal pages", () => {
  it("are translated from the English in force, so the English can't change without its Spanish", () => {
    expect(SPANISH_TRANSLATED_FROM).toEqual({ privacy: POLICY_UPDATED, terms: TERMS_UPDATED });
  });

  it("show only once a lawyer has approved them against that very English", () => {
    expect(approvedFor(null, "October 5, 2026")).toBe(false);
    expect(approvedFor("September 30, 2026", "October 5, 2026")).toBe(false);
    expect(approvedFor("October 5, 2026", "October 5, 2026")).toBe(true);
    // Until then the page is still marked English inside a Spanish one, and comes off that list when it's approved.
    for (const page of Object.keys(LEGAL_PATHS) as LegalPage[]) expect(ENGLISH_ONLY.includes(LEGAL_PATHS[page])).toBe(!spanishPublished(page));
  });

  it("say what the English says, section by section, under every combination of the operator's switches", () => {
    for (const s of SWITCHES) {
      const en = renderToStaticMarkup(PrivacyPolicy(s));
      const es = renderToStaticMarkup(PoliticaDePrivacidad(s));
      expect(shape(es), JSON.stringify(s)).toEqual(shape(en));
      expect(shape(en).length).toBeGreaterThan(8);
    }
    for (const billing of [false, true]) {
      expect(shape(renderToStaticMarkup(TerminosDelServicio({ billing }))), `billing ${billing}`).toEqual(shape(renderToStaticMarkup(TermsOfService({ billing }))));
    }
  });

  it("are Spanish all through, say the English governs, and date themselves by the English they translate", () => {
    const pages = [
      { html: renderToStaticMarkup(PoliticaDePrivacidad(SWITCHES.at(-1)!)), date: POLICY_UPDATED },
      { html: renderToStaticMarkup(PoliticaDePrivacidad(SWITCHES[0]!)), date: POLICY_UPDATED },
      { html: renderToStaticMarkup(TerminosDelServicio({ billing: false })), date: TERMS_UPDATED },
      { html: renderToStaticMarkup(TerminosDelServicio({ billing: true })), date: TERMS_UPDATED },
    ];
    for (const { html, date } of pages) {
      expect(html).toContain('id="translation"');
      expect(html).toContain("La versión en inglés es la que rige");
      expect(html).toContain(longDateEs(date));
      // An English sentence left behind would bring these with it.
      expect(words(html)).not.toMatch(/\b(the|and|your|you|with|for|they|their|isn't|don't|can't)\b/);
    }
  });

  it("have every line the policy keeps as data in Spanish, and nothing left over", () => {
    const english = new Set([
      ...STORED_ON_DEVICE.flatMap((c) => [c.what, c.lasts, c.kind]),
      ...[...PROVIDERS, RENTCAST, MEMPOOL, ALCHEMY, RESEND_WITH_ALERTS, STRIPE, ...PUSH_SERVICES].map((p) => p.does),
    ]);
    expect([...english].filter((line) => !Object.hasOwn(PRIVACY_LISTS_ES, line))).toEqual([]);
    expect(Object.keys(PRIVACY_LISTS_ES).filter((line) => !english.has(line))).toEqual([]);
    expect(listEs("1 year")).toBe("1 año");
    expect(listEs("Something new")).toBe("Something new");
  });

  it("write dates the Spanish way, and refuse one they can't read", () => {
    expect(longDateEs("October 5, 2026")).toBe("5 de octubre de 2026");
    expect(longDateEs("September 30, 2026")).toBe("30 de septiembre de 2026");
    expect(() => longDateEs("2026-10-05")).toThrow();
    expect(() => longDateEs("Octember 5, 2026")).toThrow();
  });
});

describe("the legal pages a Spanish reader is shown", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/legal-languages");
    vi.doUnmock("next/headers");
    vi.resetModules();
  });

  async function rendered(path: "privacy" | "terms", { published }: { published: boolean }) {
    vi.resetModules();
    vi.doMock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers({ "accept-language": "es-MX,es;q=0.9" }) }));
    if (published) vi.doMock("@/lib/legal-languages", async (original) => ({ ...(await original<object>()), spanishPublished: () => true }));
    const page = path === "privacy" ? await import("@/app/privacy/page") : await import("@/app/terms/page");
    return { html: renderToStaticMarkup(await page.default()), meta: await page.generateMetadata() };
  }

  it("are the English while the Spanish is held", async () => {
    const privacy = await rendered("privacy", { published: false });
    expect(privacy.html).toContain("Who we are");
    expect(privacy.html).not.toContain("Quiénes somos");
    expect(privacy.meta.title).toBe("Privacy policy");
    const terms = await rendered("terms", { published: false });
    expect(terms.html).toContain("Agreeing to these terms");
    expect(terms.meta.title).toBe("Terms of Service");
  });

  it("are the Spanish once it's approved, titled in Spanish", async () => {
    const privacy = await rendered("privacy", { published: true });
    expect(privacy.html).toContain("Quiénes somos");
    expect(privacy.meta.title).toBe("Política de privacidad");
    const terms = await rendered("terms", { published: true });
    expect(terms.html).toContain("Aceptar estos términos");
    expect(terms.meta.title).toBe("Términos del servicio");
  });
});
