// src/app/account/page.tsx — who's signed in, what Prism calls them, what
// their account holds, and the way out. An account's first sign-in lands here
// (?welcome=1) to be asked its name — the one question sign-in never asks.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarClock, Landmark, PiggyBank, Target, Wallet, type LucideIcon } from "lucide-react";
import { DeleteAccount } from "@/components/delete-account";
import { NameForm } from "@/components/name-form";
import { SignOutButton } from "@/components/sign-in-form";
import { Card, CardHeader, PageHeader, StatusPill } from "@/components/ui";
import { signOut } from "@/lib/server/auth-actions";
import { getFinance } from "@/lib/server/finance";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const data = await getFinance();
  if (!data.accountsEnabled || !data.account) redirect("/sign-in");
  const email = data.account.email ?? "your account";
  const firstName = data.account.firstName;
  const welcome = (await searchParams).welcome === "1" && !firstName;
  const banks = data.institutions.filter((i) => i.source === "plaid").length;
  const coinbase = data.institutions.some((i) => i.source === "coinbase");

  const rows: { icon: LucideIcon; label: string; value: string; on: boolean }[] = [
    { icon: Landmark, label: "Linked banks", value: banks ? `${banks} linked` : "None yet", on: banks > 0 },
    { icon: Wallet, label: "Coinbase", value: coinbase ? "Connected" : "Not connected", on: coinbase },
    { icon: Target, label: "Budgets", value: data.planEdited.budgets ? `${data.budgets.length} set by you` : "Suggested", on: data.planEdited.budgets },
    { icon: PiggyBank, label: "Goals", value: data.goals.length ? `${data.goals.length} ${data.goals.length === 1 ? "goal" : "goals"}` : "None yet", on: data.goals.length > 0 },
    { icon: CalendarClock, label: "Calendar link", value: data.account.calendarFeed ? "On" : "Off — turn it on from Future", on: data.account.calendarFeed },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Account" subtitle={`Signed in as ${email}.`} action={<SignOutButton action={signOut} />} />

      <Card className="p-5 sm:p-6">
        <CardHeader
          title={welcome ? "Welcome to Prism. What should we call you?" : "Your name"}
          subtitle={
            welcome
              ? "Your first name is only used to say good morning on the Overview. Skip it if you like; you can add it here any time."
              : "Prism uses your first name to say good morning on the Overview, and nowhere else."
          }
        />
        <NameForm firstName={firstName} welcome={welcome} />
      </Card>

      <Card className="p-5 sm:p-6">
        <CardHeader title="Saved to your account" subtitle="Everything here follows you to any device you sign in on." />
        <ul className="mt-3 divide-y divide-[var(--line)]">
          {rows.map(({ icon: Icon, label, value, on }) => (
            <li key={label} className="flex items-center gap-3 py-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-ctl bg-accent-soft text-accent">
                <Icon aria-hidden className="size-[18px]" />
              </div>
              <div className="min-w-0 flex-1 text-sm font-semibold text-ink-1">{label}</div>
              {on ? <StatusPill status="good">{value}</StatusPill> : <span className="text-sm text-ink-3">{value}</span>}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-5 sm:p-6">
        <CardHeader title="Delete your account" subtitle="Every bank link is removed at the bank, Coinbase access is revoked, and your budgets, goals and calendar link are erased. This can't be undone." />
        <DeleteAccount email={email} />
      </Card>
    </div>
  );
}
