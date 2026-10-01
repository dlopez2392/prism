// GET /account/export/transactions.csv — every transaction of the signed-in
// person's own, as a spreadsheet (?year=2025 for one year, from the year
// page). Prism's own Import history reads it back.

import { transactionsCsv } from "@/lib/finance/export";
import { download, ownMoneyOrRefusal } from "@/lib/server/export-response";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const own = await ownMoneyOrRefusal(req);
  if (own instanceof Response) return own;
  const raw = new URL(req.url).searchParams.get("year");
  const year = raw && /^\d{4}$/.test(raw) ? Number(raw) : undefined;
  const name = year === undefined ? `transactions-${own.data.today}.csv` : `transactions-${year}.csv`;
  return download(transactionsCsv(own.data, year), "text/csv; charset=utf-8", name);
}
