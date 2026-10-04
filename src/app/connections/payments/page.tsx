// src/app/connections/payments/page.tsx — who a Venmo, PayPal or Cash App
// payment was really for. None of the three lets another app read an
// account, so the person adds each app's own activity file: it's read in the
// browser and never uploaded (src/components/payment-notes.tsx), and only the
// matches are kept, sealed, in their account — so this needs one, and a bank.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { HandCoins } from "lucide-react";
import { PaymentNotes } from "@/components/payment-notes";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { appOf, type BankLine } from "@/lib/finance/p2p";
import { getPersonalFinance } from "@/lib/server/finance";

export const metadata: Metadata = { title: "Venmo, PayPal and Cash App" };

export default async function PaymentsPage() {
  const data = await getPersonalFinance();
  const header = (
    <PageHeader eyebrow="Connections" title="Venmo, PayPal and Cash App" subtitle="Who each payment was really for, on the bank line it came from — not just “Venmo −$45.00”." />
  );
  const empty = (title: string, body: string, action?: ReactNode) => (
    <div className="space-y-5">
      {header}
      <Card>
        <EmptyState icon={HandCoins} title={title} body={body} action={action} />
      </Card>
    </div>
  );

  if (!data.accountsEnabled) return empty("This needs accounts", "Who your payments were for is kept in an account, and accounts aren't set up on this site.");
  if (!data.account) {
    return empty(
      "Sign in to add who your payments were for",
      "The names and notes are kept, encrypted, in your account, beside the bank lines they explain.",
      <ButtonLink href="/sign-in?next=%2Fconnections%2Fpayments" variant="primary">
        Sign in
      </ButtonLink>,
    );
  }
  // Only the person's own lines from the three apps go to the browser: what a match needs, and nothing more.
  const lines: BankLine[] = data.source === "demo" ? [] : data.transactions.filter((t) => appOf(t.merchant) !== null).map(({ id, date, amount, merchant }) => ({ id, date, amount, merchant }));
  const noted = data.source === "demo" ? 0 : data.transactions.filter((t) => t.p2p).length;
  if (lines.length === 0) {
    return empty(
      "No Venmo, PayPal or Cash App payments yet",
      "Your payments through these apps appear here once the bank or card that pays them is linked. Then add each app's activity file, and every payment says who it was for.",
      <ButtonLink href="/connections" variant="primary">
        Link a bank
      </ButtonLink>,
    );
  }

  return (
    <div className="space-y-5">
      {header}
      <PaymentNotes lines={lines} noted={noted} />
    </div>
  );
}
