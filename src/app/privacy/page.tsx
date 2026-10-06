// src/app/privacy/page.tsx — Prism's privacy policy, in the reader's
// language once its Spanish is approved (legal-languages.ts); in English, the
// text that governs, until then. The policy itself is policy-en.tsx, and its
// translation policy-es.tsx; this page reads the operator's switches once and
// hands both the same ones, so they always say the same thing.

import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { getLocale } from "@/lib/i18n/server";
import { spanishPublished } from "@/lib/legal-languages";
import { PrivacyPolicy } from "./policy-en";
import { PoliticaDePrivacidad } from "./policy-es";
import { privacySwitches } from "./switches";

async function inSpanish(): Promise<boolean> {
  return spanishPublished("privacy") && (await getLocale()) === "es";
}

export async function generateMetadata(): Promise<Metadata> {
  return (await inSpanish())
    ? { title: "Política de privacidad", description: `Cómo maneja ${BRAND.product} los datos de tu dinero: qué lee, dónde se guarda, quién más lo ve y cómo borrarlo.` }
    : { title: "Privacy policy", description: `How ${BRAND.product} handles your money data: what it reads, where it's kept, who else sees it, and how to delete it.` };
}

export default async function PrivacyPage() {
  const switches = privacySwitches();
  return (await inSpanish()) ? <PoliticaDePrivacidad {...switches} /> : <PrivacyPolicy {...switches} />;
}
