// src/app/taxes/return/page.tsx — add a filed return. The PDF is read in the
// browser and never uploaded (components/return-upload.tsx); only the figures
// the person checks are kept, sealed in their account, and shown on Taxes
// beside this year's money. Part of Prism Plus with the tax year.

import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { PlusCard } from "@/components/plus";
import { ReturnUpload } from "@/components/return-upload";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { plusFor } from "@/lib/billing/plus";
import { getT } from "@/lib/i18n/server";
import { getPersonalFinance } from "@/lib/server/finance";
import { currentAccount } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Add a filed return") };
}

export default async function ReturnPage() {
  const [data, t, plus] = await Promise.all([getPersonalFinance(), getT(), currentAccount().then(plusFor)]);
  const header = (
    <PageHeader
      eyebrow={t("Taxes")}
      title={t("Add a filed return")}
      subtitle={t("Last year's figures beside this year's money: what you earned, the tax, the refund or the bill, and what paying enough this year looks like.")}
    />
  );
  if (!plus.plus) {
    return (
      <div className="space-y-5">
        {header}
        <PlusCard feature="taxes" trial={plus.trial} t={t} />
      </div>
    );
  }
  if (!data.account || data.source === "demo") {
    return (
      <div className="space-y-5">
        {header}
        <Card>
          <EmptyState
            icon={FileText}
            title={data.account ? t("Your return goes beside your own money") : t("Sign in to add your return")}
            body={
              data.account
                ? t("Link a bank or import your history first, and your return's figures sit beside them on Taxes.")
                : t("Its figures are kept, encrypted, in your account, and you can remove them whenever you like.")
            }
            action={
              data.account ? (
                <ButtonLink href="/connections" variant="primary">
                  {t("Go to Connections")}
                </ButtonLink>
              ) : (
                <ButtonLink href="/sign-in?next=%2Ftaxes%2Freturn" variant="primary">
                  {t("Sign in")}
                </ButtonLink>
              )
            }
          />
        </Card>
      </div>
    );
  }
  const thisYear = Number(data.today.slice(0, 4));
  return (
    <div className="space-y-5">
      {header}
      <ReturnUpload thisYear={thisYear} years={(data.taxReturns ?? []).map((r) => r.year)} />
      <p className="text-xs text-ink-3">
        {t("Information, not tax advice. The figures are what you saved from your return; Prism doesn't check them with the IRS.")}
      </p>
    </div>
  );
}
