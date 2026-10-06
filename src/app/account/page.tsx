// src/app/account/page.tsx — who's signed in, what Prism calls them, what
// their account holds, and the way out. An account's first sign-in lands here
// (?welcome=1) to be asked its name — the one question sign-in never asks.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BellRing, CalendarClock, Download, Landmark, PiggyBank, Smartphone, Target, Wallet, type LucideIcon } from "lucide-react";
import { AlertEmails } from "@/components/alert-emails";
import { ConnectedApps, type ConnectedApp } from "@/components/connected-apps";
import { DeleteAccount } from "@/components/delete-account";
import { buttonGhost, buttonPrimary } from "@/components/dialog";
import { HouseholdCard } from "@/components/household";
import { LanguageSetting } from "@/components/language-setting";
import { NameForm } from "@/components/name-form";
import { PhoneAlerts } from "@/components/phone-alerts";
import { PlusNeeded } from "@/components/plus";
import { SignOutButton } from "@/components/sign-in-form";
import { TwoStepSettings } from "@/components/two-step";
import { YourPlan } from "@/components/your-plan";
import { Card, CardHeader, PageHeader, StatusPill } from "@/components/ui";
import { alertsConfig } from "@/lib/alerts/send";
import { plusFor } from "@/lib/billing/plus";
import { BRAND } from "@/lib/brand";
import { getT } from "@/lib/i18n/server";
import { vapidKeys } from "@/lib/alerts/webpush";
import { signOut } from "@/lib/server/auth-actions";
import { connectingEnabled, MCP_PATH } from "@/lib/server/connected-apps";
import { getPersonalFinance } from "@/lib/server/finance";
import { loadHousehold, type Household } from "@/lib/server/household-store";
import { myDevices, type MyDevice } from "@/lib/server/phones";
import { requestOrigin } from "@/lib/server/origin";
import { supabaseEnv } from "@/lib/supabase/config";
import { currentAccount } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Account") };
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getT();
  const data = await getPersonalFinance();
  if (!data.accountsEnabled || !data.account) redirect("/sign-in");
  const email = data.account.email ?? t("your account");
  const firstName = data.account.firstName;
  const welcome = (await searchParams).welcome === "1" && !firstName;
  // Offered only where the job can run: Resend and the job's secret are set (never on a preview).
  const config = alertsConfig();
  const alerts = config ? data.account.alerts : null;
  const [plus, endpoint, enabled, apps, twoStepFactor, household, devices] = await Promise.all([
    currentAccount().then(plusFor),
    requestOrigin().then((o) => `${o}${MCP_PATH}`),
    connectingEnabled(supabaseEnv()!),
    connectedApps(),
    registeredFactor(),
    myHousehold(),
    alerts ? phoneDevices() : Promise.resolve(null),
  ]);
  const banks = data.institutions.filter((i) => i.source === "plaid").length;
  const coinbase = data.institutions.some((i) => i.source === "coinbase");

  const rows: { icon: LucideIcon; label: string; value: string; on: boolean }[] = [
    { icon: Landmark, label: t("Linked banks"), value: banks === 1 ? t("1 linked") : banks ? t("{n} linked", { n: banks }) : t("None yet"), on: banks > 0 },
    { icon: Wallet, label: "Coinbase", value: coinbase ? t("Connected") : t("Not connected"), on: coinbase },
    {
      icon: Target,
      label: t("Budgets"),
      value: data.planEdited.budgets ? (data.budgets.length === 1 ? t("1 set by you") : t("{n} set by you", { n: data.budgets.length })) : t("Suggested"),
      on: data.planEdited.budgets,
    },
    {
      icon: PiggyBank,
      label: t("Goals"),
      value: data.goals.length === 1 ? t("1 goal") : data.goals.length ? t("{n} goals", { n: data.goals.length }) : t("None yet"),
      on: data.goals.length > 0,
    },
    { icon: CalendarClock, label: t("Calendar link"), value: data.account.calendarFeed ? t("On") : t("Off — turn it on from Future"), on: data.account.calendarFeed },
    ...(alerts ? [{ icon: BellRing, label: t("Alert emails"), value: alerts.on ? t("On") : t("Off — turn them on below"), on: alerts.on }] : []),
    ...(alerts && devices
      ? [
          {
            icon: Smartphone,
            label: t("Alerts on devices"),
            value: devices.length === 1 ? t("1 device") : devices.length ? t("{n} devices", { n: devices.length }) : t("None yet"),
            on: devices.length > 0,
          },
        ]
      : []),
  ];

  const back = (await searchParams).plus;

  // One whole sentence, so a language can put the link where its words need it.
  const [beforeLink, afterLink] = t("Once you link a bank or import your history on {connections}, you can download all of it here.").split("{connections}");

  return (
    <div className="space-y-5">
      <PageHeader title={t("Account")} subtitle={t("Signed in as {email}.", { email })} action={<SignOutButton action={signOut} />} />

      <Card className="p-5 sm:p-6">
        <CardHeader
          title={welcome ? t("Welcome to Prism. What should we call you?") : t("Your name")}
          subtitle={
            welcome
              ? t("Your first name is only used to say good morning on the Overview. Skip it if you like; you can add it here any time.")
              : t("Prism uses your first name to say good morning on the Overview, and nowhere else.")
          }
        />
        <NameForm firstName={firstName} welcome={welcome} />
      </Card>

      <LanguageSetting />

      {plus.billing ? (
        <section id="plan" className="scroll-mt-6">
          <Card className="p-5 sm:p-6">
            <YourPlan plus={plus} back={typeof back === "string" ? back : null} t={t} />
          </Card>
        </section>
      ) : null}

      <Card className="p-5 sm:p-6">
        <CardHeader title={t("Saved to your account")} subtitle={t("Everything here follows you to any device you sign in on.")} />
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
              title={t("Alert emails")}
              subtitle={t(
                "A heads-up when a bank needs you, a bill may not be covered or a subscription goes up, and short summaries: on Mondays, and early each month for the month before. Bills and figures are as of your last visit, or this morning's check of your banks if you allow it, and each email says which. No tracking, and one click stops them.",
              )}
            />
            {plus.plus ? <AlertEmails settings={alerts} email={email} /> : <PlusNeeded feature="alerts" trial={plus.trial} t={t} quiet />}
          </Card>
        </section>
      ) : null}

      {alerts && config && plus.plus ? (
        <section id="phone" className="scroll-mt-6">
          <Card className="p-5 sm:p-6">
            <CardHeader
              title={t("Alerts on your phone")}
              subtitle={t(
                "The same alerts as your emails, as a notification, the moment each email goes. Each one is encrypted for your device, so the service that delivers it can't read it.",
              )}
            />
            <PhoneAlerts vapidKey={vapidKeys(config.secret).publicKey} devices={devices} alertsOn={alerts.on} />
          </Card>
        </section>
      ) : null}

      <section id="two-step" className="scroll-mt-6">
        <Card className="p-5 sm:p-6">
          <CardHeader
            title={t("Two-step sign-in")}
            subtitle={t("Add a code from an authenticator app on your phone to every sign-in, so your email alone can't open Prism.")}
          />
          <div className="mt-4">
            <TwoStepSettings factorId={twoStepFactor} supabase={supabaseEnv()!} />
          </div>
        </Card>
      </section>

      <section id="household" className="scroll-mt-6">
        <Card className="p-5 sm:p-6">
          <CardHeader
            title={t("Household")}
            subtitle={
              household === undefined
                ? t("We couldn't load your household just now. Try again in a minute.")
                : household
                  ? t("Everyone keeps their own login. Each of you chooses what to share on Connections, and sees only what the others share.")
                  : t("Share chosen accounts with a partner or family, up to four adults. Each of you keeps your own login, and nothing is shared until you choose it.")
            }
          />
          {household === undefined ? null : <HouseholdCard household={household} needsPlus={!plus.householdView} />}
        </Card>
      </section>

      <section id="ai" className="scroll-mt-6">
        <Card className="p-5 sm:p-6">
          <CardHeader
            title={t("Ask AI about your money")}
            subtitle={t("Connect Claude or ChatGPT, then ask things like “What did I spend on eating out last month?” Connected apps can read — never move money or change anything.")}
          />
          {plus.plus ? null : <PlusNeeded feature="apps" trial={plus.trial} t={t} quiet />}
          {/* Without Plus, an app already connected is still listed, so it can be disconnected. */}
          {plus.plus || apps?.length ? <ConnectedApps endpoint={endpoint} enabled={enabled} apps={apps} /> : null}
        </Card>
      </section>

      <section id="data" className="scroll-mt-6">
        <Card className="p-5 sm:p-6">
          <CardHeader
            title={t("Download your data")}
            subtitle={t(
              "Everything Prism shows you, yours to keep: spreadsheets of every transaction, account and month-end balance, your budgets and goals, and one file with all of it. Nothing in it can open your accounts.",
            )}
          />
          {data.source === "demo" ? (
            <p className="mt-4 rounded-ctl bg-surface-2 p-3 text-sm text-ink-2">
              {beforeLink}
              <Link href="/connections" className="font-semibold text-accent-ink underline-offset-2 hover:underline">
                {t("Connections")}
              </Link>
              {afterLink}
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <a href="/account/export/everything.zip" className={buttonPrimary}>
                <Download aria-hidden className="size-4" />
                {t("Download everything")}
              </a>
              <a href="/account/export/transactions.csv" className={buttonGhost}>
                {t("Transactions only")}
              </a>
              <Link href="/year" className="text-sm font-semibold text-accent-ink underline-offset-2 hover:underline">
                {t("See your year on one page")}
              </Link>
              <Link href="/taxes" className="text-sm font-semibold text-accent-ink underline-offset-2 hover:underline">
                {t("Your tax summary")}
              </Link>
            </div>
          )}
        </Card>
      </section>

      <Card className="p-5 sm:p-6">
        <CardHeader
          title={t("Delete your account")}
          subtitle={
            plus.own?.counts
              ? t(
                  "Your {plus} is cancelled first, so you won't be charged again. Then every bank link is removed at the bank, Coinbase access is revoked, and your budgets, goals and calendar link are erased. This can't be undone, so download your data first if you want a copy.",
                  { plus: BRAND.plus },
                )
              : t(
                  "Every bank link is removed at the bank, Coinbase access is revoked, and your budgets, goals and calendar link are erased. This can't be undone, so download your data first if you want a copy.",
                )
          }
        />
        <DeleteAccount email={email} />
      </Card>
    </div>
  );
}

/** The devices this person gets alerts on, oldest first — or null when they can't be listed right now. */
async function phoneDevices(): Promise<MyDevice[] | null> {
  const account = await currentAccount();
  return account ? myDevices(account) : null;
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
  const t = await getT();
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
      return { clientId: g.client.id, name: g.client.name?.trim() || t("An app"), host, grantedAt: g.granted_at };
    })
    .sort((a, b) => (a.grantedAt < b.grantedAt ? 1 : -1));
}
