// GET /account/export/taxes.csv?year=2025 — the tax summary of the signed-in
// person's own money (finance/taxes.ts), for whoever does their return: each
// transaction under what a return asks about, with each section's total and
// the form that holds the official figure.

import { taxesCsv } from "@/lib/finance/export";
import { defaultTaxYear } from "@/lib/finance/taxes";
import { download, ownMoneyOrRefusal } from "@/lib/server/export-response";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const own = await ownMoneyOrRefusal(req);
  if (own instanceof Response) return own;
  const raw = new URL(req.url).searchParams.get("year");
  const year = raw && /^\d{4}$/.test(raw) ? Number(raw) : defaultTaxYear(own.data);
  return download(taxesCsv(own.data, year), "text/csv; charset=utf-8", `taxes-${year}.csv`);
}
