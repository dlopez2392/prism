// src/app/terms/page.tsx — Prism's Terms of Service, in the reader's
// language once their Spanish is approved (legal-languages.ts); in English,
// the text that governs, until then. The Terms themselves are terms-en.tsx,
// and their translation terms-es.tsx; this page reads the operator's switches
// once and hands both the same ones.

import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { getLocale } from "@/lib/i18n/server";
import { spanishPublished } from "@/lib/legal-languages";
import { TermsOfService } from "./terms-en";
import { TerminosDelServicio } from "./terms-es";
import { termsSwitches } from "./switches";

async function inSpanish(): Promise<boolean> {
  return spanishPublished("terms") && (await getLocale()) === "es";
}

export async function generateMetadata(): Promise<Metadata> {
  return (await inSpanish())
    ? { title: "Términos del servicio", description: `El acuerdo entre tú y ${BRAND.company} para usar ${BRAND.product}, en palabras sencillas.` }
    : { title: "Terms of Service", description: `The agreement between you and ${BRAND.company} for using ${BRAND.product}, in plain words.` };
}

export default async function TermsPage() {
  const switches = termsSwitches();
  return (await inSpanish()) ? <TerminosDelServicio {...switches} /> : <TermsOfService {...switches} />;
}
