// src/app/connections/import/page.tsx — history from Mint, Monarch or any
// spreadsheet. The file is read in the browser and never uploaded
// (src/components/import-history.tsx); what's imported is kept sealed in the
// person's account, so this needs one.

import type { Metadata } from "next";
import { FileUp } from "lucide-react";
import { ImportHistory, type LinkedAccount } from "@/components/import-history";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { getPersonalFinance } from "@/lib/server/finance";

export const metadata: Metadata = { title: "Import history" };

export default async function ImportPage() {
  const data = await getPersonalFinance();
  const header = <PageHeader eyebrow="Connections" title="Import history" subtitle="Years of transactions from Mint, Monarch or a spreadsheet, alongside everything else in Prism." />;

  if (!data.accountsEnabled || !data.account) {
    return (
      <div className="space-y-5">
        {header}
        <Card>
          <EmptyState
            icon={FileUp}
            title={data.accountsEnabled ? "Sign in to import history" : "Importing needs accounts"}
            body={
              data.accountsEnabled
                ? "What you import is kept, encrypted, in your account, so you can see it on every device and remove it whenever you like."
                : "What you import is kept in an account, and accounts aren't set up on this site."
            }
            action={data.accountsEnabled ? <ButtonLink href="/sign-in?next=%2Fconnections%2Fimport" variant="primary">Sign in</ButtonLink> : undefined}
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
      for (const t of data.transactions) if (t.accountId === a.id && !t.id.startsWith("imp-") && (since === null || t.date < since)) since = t.date;
      return { id: a.id, name: a.name, mask: a.mask, since };
    });

  return (
    <div className="space-y-5">
      {header}
      <ImportHistory linked={linked} today={data.today} />
    </div>
  );
}
