// GET /account/export/taxes.csv?year=2025 — the tax summary of the signed-in
// person's own money (finance/taxes.ts), for whoever does their return: each
// transaction under what a return asks about, with each section's total and
// the form that holds the official figure.

import { plusNeeds } from "@/lib/billing/plans";
import { plusFor } from "@/lib/billing/plus";
import { taxesCsv } from "@/lib/finance/export";
import { getT } from "@/lib/i18n/server";
import { currentAccount } from "@/lib/supabase/server";
import { defaultTaxYear } from "@/lib/finance/taxes";
import { download, ownMoneyOrRefusal } from "@/lib/server/export-response";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const own = await ownMoneyOrRefusal(req);
  if (own instanceof Response) return own;
  // The tax summary is part of Prism Plus (the rest of the download isn't).
  const plus = await plusFor(await currentAccount());
  if (!plus.plus) return new Response(`${plusNeeds("taxes", await getT())}\n`, { status: 402, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
  const raw = new URL(req.url).searchParams.get("year");
  const year = raw && /^\d{4}$/.test(raw) ? Number(raw) : defaultTaxYear(own.data);
  return download(taxesCsv(own.data, year), "text/csv; charset=utf-8", `taxes-${year}.csv`);
}
