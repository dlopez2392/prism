// src/app/connections/page.tsx — what's linked, how healthy each
// link is, and everything Prism can connect to next.
//
// Hero (the one --gradient-prism card): the connect action and the promise
// behind it. Connection health is shown per institution, in words and icons —
// "sync broke silently" is the most common reason people quit these apps.

import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, FileUp, Gauge, House, KeyRound, Landmark, Lock, Plus, RotateCw, ShieldCheck, Sparkles, TrendingUp, Unplug, type LucideIcon } from "lucide-react";
import { ConnectBank } from "@/components/connect-bank";
import { DisconnectButton } from "@/components/disconnect-button";
import { RemoveImport } from "@/components/remove-import";
import { ShareAccounts, type ShareableAccount } from "@/components/household";
import { ButtonLink, Card, CardHeader, EmptyState, PageHeader, Pill, StatusPill, type Status } from "@/components/ui";
import { money0, monthYear, shortDate } from "@/lib/finance/format";
import { coinbaseConfig } from "@/lib/coinbase/client";
import { INTEGRATIONS, type IntegrationStatus } from "@/lib/finance/integrations";
import { liabilitiesEnabled } from "@/lib/plaid/liabilities";
import { signInToConnect } from "@/lib/linking";
import type { Institution } from "@/lib/finance/types";
import { getPersonalFinance } from "@/lib/server/finance";
import { loadShares } from "@/lib/server/household-store";
import { currentAccount } from "@/lib/supabase/server";
import { vaultKey } from "@/lib/server/vault";

export const metadata: Metadata = { title: "Connections" };

const ICONS: Record<string, LucideIcon> = { landmark: Landmark, "trending-up": TrendingUp, house: House, gauge: Gauge, sparkles: Sparkles };

const HEALTH: Record<Institution["health"], { status: Status; label: string }> = {
  healthy: { status: "good", label: "Healthy" },
  syncing: { status: "syncing", label: "Syncing" },
  needs_attention: { status: "warn", label: "Can't be reached right now" },
};

/** How a connection is doing, in words: only the person can fix a bank that wants them to sign in again, so it says so. */
const health = (inst: Institution) => (inst.signInAgain ? { status: "warn" as const, label: "Needs you to sign in" } : HEALTH[inst.health]);

const INTEGRATION: Record<IntegrationStatus, { status: Status; label: string }> = {
  live: { status: "good", label: "Live" },
  planned: { status: "neutral", label: "On the roadmap" },
  partner: { status: "neutral", label: "Needs a partner" },
  limited: { status: "serious", label: "Limited access" },
};

/** Where the trip to Coinbase ended, told in plain words on the way back. */
const COINBASE_OUTCOME: Record<string, { status: Status; text: string }> = {
  connected: { status: "good", text: "Coinbase is connected. Your crypto now counts toward your net worth." },
  cancelled: { status: "neutral", text: "Coinbase wasn't connected — you stopped on Coinbase's screen. Nothing was shared." },
  expired: { status: "warn", text: "That Coinbase sign-in took too long or started in another browser. Try again from here." },
  failed: { status: "warn", text: "Coinbase didn't finish connecting. Try again in a minute." },
  not_configured: { status: "neutral", text: "Coinbase isn't switched on for this version of Prism yet." },
  accounts_required: { status: "neutral", text: "Connecting Coinbase needs a Prism account, and accounts aren't set up on this site." },
};

/** Coinbase keys plus a vault key to seal its tokens — both, or the button stays hidden. */
function coinbaseReady(): boolean {
  try {
    return coinbaseConfig() !== null && vaultKey() !== null;
  } catch {
    return false;
  }
}

function synced(inst: Institution, today: string): string {
  const at = inst.lastSyncedAt;
  // Something added by hand is updated by its owner; a connection that has never synced says so.
  if (!at) return inst.source === "manual" ? "Updated by you" : "Not updated yet";
  const day = at.slice(0, 10);
  const time = at.slice(11, 16);
  return day === today ? `Synced today at ${time} UTC` : `Last synced ${day}`;
}

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const data = await getPersonalFinance();
  const joined = (await searchParams).joined === "1";
  const shares = data.inHousehold ? await myShares() : [];
  const institutionName = new Map(data.institutions.map((i) => [i.id, i.name]));
  // Only the person's own money, and only what the household can be shown without anyone's access.
  const shareable: ShareableAccount[] =
    data.source === "demo"
      ? []
      : data.accounts.map((a) => ({
          id: a.id,
          name: a.name,
          detail:
            a.source === "coinbase"
              ? "Its total value, as of your last visit. Nobody else's visit reaches your Coinbase."
              : `${institutionName.get(a.institutionId) ?? ""}${a.mask ? ` ·· ${a.mask}` : ""}`,
          itemId: a.source === "plaid" ? a.institutionId : null,
          shareable: true,
        }));
  // Shared, but Coinbase couldn't be reached just now: still listed, so it can always be unshared.
  if (shares?.includes("coinbase") && !shareable.some((a) => a.id === "coinbase")) {
    shareable.push({ id: "coinbase", name: "Coinbase", detail: "Can't be reached just now. You can stop sharing it any time.", itemId: null, shareable: true });
  }
  // Real money connects only to an account (src/lib/linking.ts): signed out, the button goes to sign-in first.
  const signInFirst = data.accountsEnabled && !data.account;
  const outcomeKey = (await searchParams).coinbase;
  const outcome = typeof outcomeKey === "string" ? COINBASE_OUTCOME[outcomeKey] : undefined;
  const cbReady = coinbaseReady();
  const cbLinked = data.institutions.some((i) => i.source === "coinbase");
  // Imported history is listed on its own card below, where it can be removed.
  const byInstitution = data.institutions.filter((inst) => inst.source !== "import").map((inst) => {
    const accounts = data.accounts.filter((a) => a.institutionId === inst.id);
    return { inst, accounts, total: accounts.reduce((s, a) => s + a.balance, 0) };
  });
  const attention = data.institutions.filter((i) => i.health === "needs_attention").length;

  return (
    <div className="space-y-5">
      <PageHeader title="Connections" subtitle="Every account Prism reads from, how healthy each link is, and what's coming next." />
      {outcome ? (
        <p role="status" className="-mt-2">
          <StatusPill status={outcome.status} className="px-3 py-1.5 text-sm">
            {outcome.text}
          </StatusPill>
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card hero className="p-5 sm:p-6 lg:col-span-7">
          <div className="text-sm font-semibold text-[var(--on-hero-soft)]">{data.source === "demo" ? "You're on demo data" : "Add another account"}</div>
          <div className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Link a bank in about a minute.</div>
          <p className="mt-2 max-w-lg text-sm text-[var(--on-hero-soft)]">
            You sign in on your bank&apos;s own screen through Plaid, the network behind most US money apps. Prism gets read-only access — it can
            see balances and transactions, and it can never move money.
          </p>
          <ConnectBank variant="hero" label={signInFirst ? "Sign in to connect a bank" : "Connect a bank"} signInFirst={signInFirst} className="mt-5" />
        </Card>

        <Card className="p-5 sm:p-6 lg:col-span-5">
          <CardHeader title="How your data is protected" />
          <ul className="mt-4 space-y-3.5 text-sm">
            <Assurance icon={Lock} title="Read-only, always" body="Prism can't move money, pay bills or open accounts." />
            <Assurance icon={KeyRound} title="Your passwords never touch Prism" body="You sign in on your bank's or Coinbase's own screen; Prism receives a revocable token." />
            <Assurance icon={ShieldCheck} title="Tokens are encrypted" body="Sealed with AES-256-GCM on the server; your browser never holds a readable copy." />
            <Assurance icon={Unplug} title="Disconnect means gone" body="Removing a connection revokes its token at the source, not just in this app." />
          </ul>
        </Card>
      </div>

      <Card className="p-5 sm:p-6">
        <CardHeader
          title="Linked institutions"
          subtitle={attention ? `${attention} ${attention === 1 ? "needs" : "need"} your attention` : "Every connection is healthy"}
          action={data.source === "demo" ? <Pill>Demo</Pill> : undefined}
        />
        <ul className="mt-3 divide-y divide-[var(--line)]">
          {byInstitution.map(({ inst, accounts, total }) => (
            <li key={inst.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
              <div className="grid size-10 shrink-0 place-items-center rounded-ctl bg-surface-2 text-sm font-extrabold text-ink-1">{inst.name.slice(0, 1)}</div>
              {/* On a phone the name and when it last synced may wrap: that line is what this screen is for. */}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-ink-1 [overflow-wrap:anywhere] sm:truncate">{inst.name}</div>
                <div className="text-xs text-ink-3 sm:truncate">
                  {accounts.length} {accounts.length === 1 ? "account" : "accounts"} · {synced(inst, data.today)}
                </div>
              </div>
              <div className="num shrink-0 text-right text-sm font-bold text-ink-1 sm:w-28">{money0(total)}</div>
              <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                {inst.source === "manual" ? (
                  // Nothing connects to it, so there's no health to report: it's edited where it's counted.
                  <Link href="/net-worth" className="text-xs font-semibold text-accent-ink hover:underline">
                    Edit on Net worth
                  </Link>
                ) : (
                  <StatusPill status={health(inst).status} className="whitespace-nowrap">
                    {health(inst).label}
                  </StatusPill>
                )}
                {/* Signing in again keeps the same connection: its accounts, goals and household shares carry on. */}
                {inst.source === "plaid" && inst.signInAgain ? <ConnectBank label="Sign in again" reconnect={inst.id} size="sm" /> : null}
                {inst.source === "coinbase" && inst.signInAgain && cbReady ? (
                  <a
                    href="/api/coinbase/connect"
                    className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-ctl border border-line-strong px-2.5 text-xs font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3"
                  >
                    <RotateCw aria-hidden className="size-3.5" strokeWidth={2.5} />
                    Sign in again
                  </a>
                ) : null}
                {inst.source === "plaid" ? <DisconnectButton itemId={inst.id} name={inst.name} /> : null}
                {inst.source === "coinbase" ? <DisconnectButton itemId={inst.id} name={inst.name} endpoint="/api/coinbase/disconnect" /> : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {data.account ? (
        <section id="imported" className="scroll-mt-6">
          <Card className="p-5 sm:p-6">
            <CardHeader
              title="Imported history"
              subtitle="Transactions from Mint, Monarch or a spreadsheet. Kept encrypted in your account, never shared with your household."
              action={
                data.imports.length || data.lockedImports.length ? (
                  <ButtonLink href="/connections/import">
                    <FileUp aria-hidden className="size-4" />
                    Import a file
                  </ButtonLink>
                ) : undefined
              }
            />
            {data.imports.length || data.lockedImports.length ? (
              <ul className="mt-3 divide-y divide-[var(--line)]">
                {data.imports.map((imp) => {
                  const into = imp.attachTo ? data.accounts.find((a) => a.id === imp.attachTo) : undefined;
                  return (
                    <li key={imp.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
                      <div className="grid size-10 shrink-0 place-items-center rounded-ctl bg-surface-2 text-ink-2">
                        <FileUp aria-hidden className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-ink-1 [overflow-wrap:anywhere]">{imp.name}</div>
                        <div className="text-xs text-ink-3">
                          {imp.rows.toLocaleString("en-US")} {imp.rows === 1 ? "transaction" : "transactions"} · {monthYear(imp.from)} – {monthYear(imp.to)} ·{" "}
                          {into ? `older history of ${into.name}${into.mask ? ` ·· ${into.mask}` : ""}` : "an account of its own"}
                        </div>
                      </div>
                      <RemoveImport id={imp.id} name={imp.name} rows={imp.rows} />
                    </li>
                  );
                })}
                {data.lockedImports.map((imp) => (
                  <li key={imp.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
                    <div className="grid size-10 shrink-0 place-items-center rounded-ctl bg-surface-2 text-ink-2">
                      <Lock aria-hidden className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-ink-1">An import Prism can&apos;t open</div>
                      <div className="text-xs text-ink-3">
                        Imported {shortDate(imp.importedAt.slice(0, 10))}, {imp.importedAt.slice(0, 4)} · It was saved with an encryption key Prism no longer has, so
                        none of it can be shown. Remove it to free its place.
                      </div>
                    </div>
                    <RemoveImport id={imp.id} name={null} rows={null} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={FileUp}
                title="Bring your history with you"
                body="Import years of transactions from a Mint or Monarch export or any spreadsheet, and every chart reaches further back. The file never leaves your browser."
                action={<ButtonLink href="/connections/import">Import a file</ButtonLink>}
              />
            )}
          </Card>
        </section>
      ) : null}

      {data.inHousehold ? (
        <section id="share" className="scroll-mt-6">
          <Card className="p-5 sm:p-6">
            <CardHeader
              title="Shared with your household"
              subtitle={
                joined
                  ? "Welcome to the household. Nothing of yours is shared yet: choose what they see."
                  : "Private until you share it. They see a shared account's balances and transactions, never a way into your bank."
              }
            />
            {shares === null ? (
              <p className="mt-3 text-sm text-ink-3">We couldn&apos;t load what you share just now. Try again in a minute.</p>
            ) : (
              <ShareAccounts accounts={shareable} shared={shares} />
            )}
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="catalog">
        <h2 id="catalog" className="mb-1 text-lg font-extrabold tracking-tight">
          Everything Prism can connect to
        </h2>
        <p className="mb-4 text-sm text-ink-2">What each connection adds, and exactly how it works — including the ones that don&apos;t have an easy way in yet.</p>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {INTEGRATIONS.map((g) => {
            const Icon = ICONS[g.icon] ?? Sparkles;
            return (
              <Card key={g.title} className="p-5">
                <div className="flex items-center gap-2.5">
                  <div className="grid size-9 place-items-center rounded-ctl bg-accent-soft text-accent">
                    <Icon aria-hidden className="size-[18px]" />
                  </div>
                  <h3 className="text-[15px] font-bold text-ink-1">{g.title}</h3>
                </div>
                <ul className="mt-4 space-y-4">
                  {g.items.map((it) => {
                    // Coinbase is live wherever this deployment has its keys; due dates wherever reading them is switched on.
                    const status: IntegrationStatus = (it.id === "coinbase" && cbReady) || (it.id === "due-dates" && liabilitiesEnabled()) ? "live" : it.status;
                    return (
                      <li key={it.id}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-sm font-semibold text-ink-1">{it.name}</div>
                          <StatusPill status={INTEGRATION[status].status} className="shrink-0">
                            {INTEGRATION[status].label}
                          </StatusPill>
                        </div>
                        <p className="mt-1 text-[13px] text-ink-2">{it.adds}</p>
                        <p className="mt-1 text-xs text-ink-3">{it.how}</p>
                        {it.id === "csv" && data.accountsEnabled ? (
                          <Link
                            href={signInFirst ? "/sign-in?next=%2Fconnections%2Fimport" : "/connections/import"}
                            className="mt-2.5 inline-flex h-9 items-center gap-1.5 rounded-ctl border border-line-strong px-3.5 text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3"
                          >
                            <FileUp aria-hidden className="size-4" />
                            {signInFirst ? "Sign in to import a file" : "Import a file"}
                          </Link>
                        ) : null}
                        {it.id === "payroll" ? (
                          <Link
                            href="/cash-flow#income"
                            className="mt-2.5 inline-flex h-9 items-center gap-1.5 rounded-ctl border border-line-strong px-3.5 text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3"
                          >
                            <Banknote aria-hidden className="size-4" />
                            See your paychecks
                          </Link>
                        ) : null}
                        {it.id === "mcp" && data.accountsEnabled ? (
                          <Link
                            href={signInFirst ? "/sign-in?next=%2Faccount" : "/account#ai"}
                            className="mt-2.5 inline-flex h-9 items-center gap-1.5 rounded-ctl border border-line-strong px-3.5 text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3"
                          >
                            <Sparkles aria-hidden className="size-4" />
                            {signInFirst ? "Sign in to connect an AI app" : "Connect an AI app"}
                          </Link>
                        ) : null}
                        {it.id === "coinbase" && cbReady ? (
                          cbLinked ? (
                            <p className="mt-2.5 text-xs font-semibold text-good-ink">Connected — it&apos;s in your linked institutions above.</p>
                          ) : (
                            // A plain link: the trip to Coinbase is a full-page navigation.
                            <a
                              href={signInFirst ? signInToConnect("coinbase", "/connections") : "/api/coinbase/connect"}
                              className="mt-2.5 inline-flex h-9 items-center gap-1.5 rounded-ctl border border-line-strong px-3.5 text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3"
                            >
                              <Plus aria-hidden className="size-4" />
                              {signInFirst ? "Sign in to connect Coinbase" : "Connect Coinbase"}
                            </a>
                          )
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Assurance({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
        <Icon aria-hidden className="size-4" />
      </div>
      <div>
        <div className="font-semibold text-ink-1">{title}</div>
        <div className="text-[13px] text-ink-2">{body}</div>
      </div>
    </li>
  );
}

/** The account ids this person shares; null when they can't be read right now. */
async function myShares(): Promise<string[] | null> {
  const account = await currentAccount();
  if (!account) return [];
  try {
    return [...(await loadShares(account)).keys()];
  } catch {
    return null;
  }
}
