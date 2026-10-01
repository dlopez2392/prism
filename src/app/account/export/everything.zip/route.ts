// GET /account/export/everything.zip — everything Prism shows the signed-in
// person about their own money, as spreadsheets and one JSON file, with a
// README saying what each holds. Nothing in it opens anything: no bank or
// Coinbase token, no calendar link, no sealed value (export.ts).

import { BRAND } from "@/lib/brand";
import { accountsCsv, balancesCsv, budgetsCsv, everythingJson, EXPORT_README, goalsCsv, holdingsCsv, transactionsCsv } from "@/lib/finance/export";
import { download, ownMoneyOrRefusal } from "@/lib/server/export-response";
import { zip } from "@/lib/server/zip";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const own = await ownMoneyOrRefusal(req);
  if (own instanceof Response) return own;
  const { data } = own;
  const extras = {
    wallets: data.wallets.map((w) => ({ name: w.name, chain: w.chain, address: w.address })),
    manual: data.manual,
    homes: data.homeValues.map((h) => ({ address: h.address, estimate: h.estimate })),
  };
  const json = everythingJson(data, extras, { email: own.email, firstName: data.account?.firstName ?? null }, new Date().toISOString());
  const body = zip([
    { name: "README.txt", content: EXPORT_README(BRAND.product, data.today) },
    { name: "transactions.csv", content: transactionsCsv(data) },
    { name: "accounts.csv", content: accountsCsv(data) },
    { name: "balances.csv", content: balancesCsv(data) },
    { name: "budgets.csv", content: budgetsCsv(data.budgets) },
    { name: "goals.csv", content: goalsCsv(data.goals) },
    { name: "holdings.csv", content: holdingsCsv(data) },
    { name: "everything.json", content: `${JSON.stringify(json, null, 2)}\n` },
  ]);
  return download(body, "application/zip", `export-${data.today}.zip`);
}
