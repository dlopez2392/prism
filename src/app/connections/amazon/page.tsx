// src/app/connections/amazon/page.tsx — what an Amazon charge paid for.
// Amazon doesn't let another app read an account, so the person adds their
// own order history: it's read in the browser and never uploaded
// (src/components/amazon-orders.tsx), and only the matches are kept, sealed,
// in their account — so this needs one, and the card they pay Amazon with.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Package } from "lucide-react";
import { AmazonOrders } from "@/components/amazon-orders";
import { PlusCard } from "@/components/plus";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { isAmazon, type BankLine } from "@/lib/finance/orders";
import { plusFor } from "@/lib/billing/plus";
import { getPersonalFinance } from "@/lib/server/finance";
import { currentAccount } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Amazon orders") };
}

export default async function AmazonPage() {
  const [data, t] = await Promise.all([getPersonalFinance(), getT()]);
  const header = (
    <PageHeader
      eyebrow={t("Connections")}
      title={t("Amazon orders")}
      subtitle={t("What each Amazon charge paid for, on the bank line it came from — not just “AMZN Mktp US −$86.40”.")}
    />
  );
  const empty = (title: string, body: string, action?: ReactNode) => (
    <div className="space-y-5">
      {header}
      <Card>
        <EmptyState icon={Package} title={title} body={body} action={action} />
      </Card>
    </div>
  );

  if (!data.accountsEnabled) return empty(t("This needs accounts"), t("What your Amazon charges paid for is kept in an account, and accounts aren't set up on this site."));
  if (!data.account) {
    return empty(
      t("Sign in to add your Amazon orders"),
      t("What each charge paid for is kept, encrypted, in your account, beside the bank line it explains."),
      <ButtonLink href="/sign-in?next=%2Fconnections%2Famazon" variant="primary">
        {t("Sign in")}
      </ButtonLink>,
    );
  }
  // Only the person's own Amazon charges go to the browser: what a match needs, and nothing more.
  const lines: BankLine[] = data.source === "demo" ? [] : data.transactions.filter((txn) => txn.amount < 0 && isAmazon(txn.merchant)).map(({ id, date, amount, merchant }) => ({ id, date, amount, merchant }));
  const noted = data.source === "demo" ? 0 : data.transactions.filter((txn) => txn.order).length;
  if (lines.length === 0) {
    return empty(
      t("No Amazon charges yet"),
      t("Your Amazon charges appear here once the card or bank you pay Amazon with is linked. Then add your order history, and every charge says what it paid for."),
      <ButtonLink href="/connections" variant="primary">
        {t("Link a card")}
      </ButtonLink>,
    );
  }

  // Matching is part of Prism Plus. Without it the orders already kept stay, and can still be removed.
  const plus = await plusFor(await currentAccount());
  return (
    <div className="space-y-5">
      {header}
      {plus.plus ? null : <PlusCard feature="matching" trial={plus.trial} t={t} />}
      {plus.plus || noted > 0 ? <AmazonOrders lines={lines} noted={noted} /> : null}
    </div>
  );
}
