// src/app/connections/import/page.tsx — history from Mint, Monarch or any
// spreadsheet. The file is read in the browser and never uploaded
// (src/components/import-history.tsx); what's imported is kept sealed in the
// person's account, so this needs one.

import type { Metadata } from "next";
import { FileUp } from "lucide-react";
import { ImportHistory, type LinkedAccount } from "@/components/import-history";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { getPersonalFinance } from "@/lib/server/finance";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Import history") };
}

export default async function ImportPage() {
  const [data, t] = await Promise.all([getPersonalFinance(), getT()]);
  const header = (
    <PageHeader eyebrow={t("Connections")} title={t("Import history")} subtitle={t("Years of transactions from Mint, Monarch or a spreadsheet, alongside everything else in Prism.")} />
  );

  if (!data.accountsEnabled || !data.account) {
    return (
      <div className="space-y-5">
        {header}
        <Card>
          <EmptyState
            icon={FileUp}
            title={data.accountsEnabled ? t("Sign in to import history") : t("Importing needs accounts")}
            body={
              data.accountsEnabled
                ? t("What you import is kept, encrypted, in your account, so you can see it on every device and remove it whenever you like.")
                : t("What you import is kept in an account, and accounts aren't set up on this site.")
            }
            action={
              data.accountsEnabled ? (
                <ButtonLink href="/sign-in?next=%2Fconnections%2Fimport" variant="primary">
                  {t("Sign in")}
                </ButtonLink>
              ) : undefined
            }
          />
        </Card>
      </div>
    );
  }

  // Each linked bank account, and the day its own history starts: an import adds only what's older.
  const linked: LinkedAccount[] = data.accounts
    .filter((a) => a.source === "plaid")
    .map((a) => {
      let since: string | null = null;
      for (const txn of data.transactions) if (txn.accountId === a.id && !txn.id.startsWith("imp-") && (since === null || txn.date < since)) since = txn.date;
      return { id: a.id, name: a.name, mask: a.mask, since };
    });

  return (
    <div className="space-y-5">
      {header}
      <ImportHistory linked={linked} today={data.today} />
    </div>
  );
}
