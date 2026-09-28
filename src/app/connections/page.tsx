// src/app/connections/page.tsx — what's linked, how healthy each
// link is, and everything Prism can connect to next.
//
// Hero (the one --gradient-prism card): the connect action and the promise
// behind it. Connection health is shown per institution, in words and icons —
// "sync broke silently" is the most common reason people quit these apps.

import type { Metadata } from "next";
import { Gauge, House, KeyRound, Landmark, Lock, Plus, ShieldCheck, Sparkles, TrendingUp, Unplug, type LucideIcon } from "lucide-react";
import { ConnectBank } from "@/components/connect-bank";
import { DisconnectButton } from "@/components/disconnect-button";
import { Card, CardHeader, PageHeader, Pill, StatusPill, type Status } from "@/components/ui";
import { money0 } from "@/lib/finance/format";
import { coinbaseConfig } from "@/lib/coinbase/client";
import { INTEGRATIONS, type IntegrationStatus } from "@/lib/finance/integrations";
import type { Institution } from "@/lib/finance/types";
import { getFinance } from "@/lib/server/finance";
import { vaultKey } from "@/lib/server/vault";

export const metadata: Metadata = { title: "Connections" };

const ICONS: Record<string, LucideIcon> = { landmark: Landmark, "trending-up": TrendingUp, house: House, gauge: Gauge, sparkles: Sparkles };

const HEALTH: Record<Institution["health"], { status: Status; label: string }> = {
  healthy: { status: "good", label: "Healthy" },
  syncing: { status: "syncing", label: "Syncing" },
  needs_attention: { status: "warn", label: "Needs you to sign in" },
};

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
};

/** Coinbase keys plus a vault key to seal its tokens — both, or the button stays hidden. */
function coinbaseReady(): boolean {
  try {
    return coinbaseConfig() !== null && vaultKey() !== null;
  } catch {
    return false;
  }
}

function synced(at: string | null, today: string): string {
  if (!at) return "Updated by you";
  const day = at.slice(0, 10);
  const time = at.slice(11, 16);
  return day === today ? `Synced today at ${time} UTC` : `Last synced ${day}`;
}

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const data = await getFinance();
  const outcomeKey = (await searchParams).coinbase;
  const outcome = typeof outcomeKey === "string" ? COINBASE_OUTCOME[outcomeKey] : undefined;
  const cbReady = coinbaseReady();
  const cbLinked = data.institutions.some((i) => i.source === "coinbase");
  const byInstitution = data.institutions.map((inst) => {
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
          <ConnectBank variant="hero" label="Connect a bank" className="mt-5" />
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
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-ink-1">{inst.name}</div>
                <div className="truncate text-xs text-ink-3">
                  {accounts.length} {accounts.length === 1 ? "account" : "accounts"} · {synced(inst.lastSyncedAt, data.today)}
                </div>
              </div>
              <div className="num w-28 text-right text-sm font-bold text-ink-1">{money0(total)}</div>
              <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                <StatusPill status={HEALTH[inst.health].status}>{HEALTH[inst.health].label}</StatusPill>
                {inst.source === "plaid" ? <DisconnectButton itemId={inst.id} name={inst.name} /> : null}
                {inst.source === "coinbase" ? <DisconnectButton itemId={inst.id} name={inst.name} endpoint="/api/coinbase/disconnect" /> : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>

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
                    // Coinbase is live wherever this deployment has its keys.
                    const status: IntegrationStatus = it.id === "coinbase" && cbReady ? "live" : it.status;
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
                        {it.id === "coinbase" && cbReady ? (
                          cbLinked ? (
                            <p className="mt-2.5 text-xs font-semibold text-good-ink">Connected — it&apos;s in your linked institutions above.</p>
                          ) : (
                            // A plain link: the trip to Coinbase is a full-page navigation.
                            <a
                              href="/api/coinbase/connect"
                              className="mt-2.5 inline-flex h-9 items-center gap-1.5 rounded-ctl border border-line-strong px-3.5 text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3"
                            >
                              <Plus aria-hidden className="size-4" />
                              Connect Coinbase
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
