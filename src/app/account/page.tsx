// src/app/account/page.tsx — who's signed in, what Prism calls them, what
// their account holds, and the way out. An account's first sign-in lands here
// (?welcome=1) to be asked its name — the one question sign-in never asks.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BellRing, CalendarClock, Landmark, PiggyBank, Target, Wallet, type LucideIcon } from "lucide-react";
import { AlertEmails } from "@/components/alert-emails";
import { ConnectedApps, type ConnectedApp } from "@/components/connected-apps";
import { DeleteAccount } from "@/components/delete-account";
import { HouseholdCard } from "@/components/household";
import { NameForm } from "@/components/name-form";
import { SignOutButton } from "@/components/sign-in-form";
import { TwoStepSettings } from "@/components/two-step";
import { Card, CardHeader, PageHeader, StatusPill } from "@/components/ui";
import { alertsConfig } from "@/lib/alerts/send";
import { signOut } from "@/lib/server/auth-actions";
import { connectingEnabled, MCP_PATH } from "@/lib/server/connected-apps";
import { getPersonalFinance } from "@/lib/server/finance";
import { loadHousehold, type Household } from "@/lib/server/household-store";
import { requestOrigin } from "@/lib/server/origin";
import { supabaseEnv } from "@/lib/supabase/config";
import { currentAccount } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const data = await getPersonalFinance();
  if (!data.accountsEnabled || !data.account) redirect("/sign-in");
  const email = data.account.email ?? "your account";
  const firstName = data.account.firstName;
  const welcome = (await searchParams).welcome === "1" && !firstName;
  const [endpoint, enabled, apps, twoStepFactor, household] = await Promise.all([
    requestOrigin().then((o) => `${o}${MCP_PATH}`),
    connectingEnabled(supabaseEnv()!),
    connectedApps(),
    registeredFactor(),
    myHousehold(),
  ]);
  const banks = data.institutions.filter((i) => i.source === "plaid").length;
  // Offered only where the job can run: Resend and the job's secret are set (never on a preview).
  const alerts = alertsConfig() ? data.account.alerts : null;
  const coinbase = data.institutions.some((i) => i.source === "coinbase");

  const rows: { icon: LucideIcon; label: string; value: string; on: boolean }[] = [
    { icon: Landmark, label: "Linked banks", value: banks ? `${banks} linked` : "None yet", on: banks > 0 },
    { icon: Wallet, label: "Coinbase", value: coinbase ? "Connected" : "Not connected", on: coinbase },
    { icon: Target, label: "Budgets", value: data.planEdited.budgets ? `${data.budgets.length} set by you` : "Suggested", on: data.planEdited.budgets },
    { icon: PiggyBank, label: "Goals", value: data.goals.length ? `${data.goals.length} ${data.goals.length === 1 ? "goal" : "goals"}` : "None yet", on: data.goals.length > 0 },
    { icon: CalendarClock, label: "Calendar link", value: data.account.calendarFeed ? "On" : "Off — turn it on from Future", on: data.account.calendarFeed },
    ...(alerts ? [{ icon: BellRing, label: "Alert emails", value: alerts.on ? "On" : "Off — turn them on below", on: alerts.on }] : []),
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

      {alerts ? (
        <section id="alerts" className="scroll-mt-6">
          <Card className="p-5 sm:p-6">
            <CardHeader
              title="Alert emails"
              subtitle="A heads-up when a bank needs you, a bill may not be covered or a subscription goes up, and a short summary on Mondays. Bills and figures are as of your last visit, or this morning's check of your banks if you allow it, and each email says which. No tracking, and one click stops them."
            />
            <AlertEmails settings={alerts} email={email} />
          </Card>
        </section>
      ) : null}

      <section id="two-step" className="scroll-mt-6">
        <Card className="p-5 sm:p-6">
          <CardHeader
            title="Two-step sign-in"
            subtitle="Add a code from an authenticator app on your phone to every sign-in, so your email alone can't open Prism."
          />
          <div className="mt-4">
            <TwoStepSettings factorId={twoStepFactor} supabase={supabaseEnv()!} />
          </div>
        </Card>
      </section>

      <section id="household" className="scroll-mt-6">
        <Card className="p-5 sm:p-6">
          <CardHeader
            title="Household"
            subtitle={
              household === undefined
                ? "We couldn't load your household just now. Try again in a minute."
                : household
                  ? "Everyone keeps their own login. Each of you chooses what to share on Connections, and sees only what the others share."
                  : "Share chosen accounts with a partner or family, up to four adults. Each of you keeps your own login, and nothing is shared until you choose it."
            }
          />
          {household === undefined ? null : <HouseholdCard household={household} />}
        </Card>
      </section>

      <section id="ai" className="scroll-mt-6">
        <Card className="p-5 sm:p-6">
          <CardHeader
            title="Ask AI about your money"
            subtitle="Connect Claude or ChatGPT, then ask things like “What did I spend on eating out last month?” Connected apps can read — never move money or change anything."
          />
          <ConnectedApps endpoint={endpoint} enabled={enabled} apps={apps} />
        </Card>
      </section>

      <Card className="p-5 sm:p-6">
        <CardHeader title="Delete your account" subtitle="Every bank link is removed at the bank, Coinbase access is revoked, and your budgets, goals and calendar link are erased. This can't be undone." />
        <DeleteAccount email={email} />
      </Card>
    </div>
  );
}

/** Their household; null when they're in none, undefined when it can't be read right now. */
async function myHousehold(): Promise<Household | null | undefined> {
  const account = await currentAccount();
  if (!account) return null;
  try {
    return await loadHousehold(account);
  } catch {
    return undefined;
  }
}

/** The authenticator behind two-step sign-in (one Supabase still has as verified), or null when it's off. */
async function registeredFactor(): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return null;
  const { data } = await account.supabase.rpc("my_second_step_factor");
  return typeof data === "string" ? data : null;
}

/** The apps this person has let in, newest first — or null when they can't be listed right now. */
async function connectedApps(): Promise<ConnectedApp[] | null> {
  const account = await currentAccount();
  if (!account) return null;
  const { data, error } = await account.supabase.auth.oauth.listGrants();
  if (error || !data) return null;
  return data
    .map((g) => {
      let host: string | null = null;
      try {
        host = g.client.uri ? new URL(g.client.uri).host : null;
      } catch {
        host = null;
      }
      return { clientId: g.client.id, name: g.client.name?.trim() || "An app", host, grantedAt: g.granted_at };
    })
    .sort((a, b) => (a.grantedAt < b.grantedAt ? 1 : -1));
}
