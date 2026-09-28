// src/app/oauth/consent/page.tsx — "Let this app read your money?"
//
// Where Supabase's OAuth server sends a person when Claude, ChatGPT or any
// MCP client asks to connect. An app names itself (anyone can register one),
// so the page leads with what can be checked — the site the person will be
// sent back to — and says in plain words what the app can and can't do.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Ban, CalendarClock, CircleAlert, CloudOff, KeyRound, Landmark, Mail, PencilOff, Search, type LucideIcon } from "lucide-react";
import { ConsentButtons } from "@/components/consent-buttons";
import { PrismMark } from "@/components/shell";
import { Card, EmptyState } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { decideConnection } from "@/lib/server/connected-apps-actions";
import { supabaseEnv } from "@/lib/supabase/config";
import { currentAccount } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Connect an app" };

const AUTHORIZATION_ID = /^[A-Za-z0-9._~-]{1,256}$/;

function hostOf(uri: string): string | null {
  try {
    const u = new URL(uri);
    return u.protocol === "https:" || u.protocol === "http:" ? u.host : u.protocol.replace(/:$/, "");
  } catch {
    return null;
  }
}

function Problem({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-md pt-2 sm:pt-8">
      <Card>
        <EmptyState icon={CircleAlert} title={title} body={body} />
      </Card>
    </div>
  );
}

function Line({ icon: Icon, children, tone }: { icon: LucideIcon; children: React.ReactNode; tone: "can" | "cannot" }) {
  return (
    <li className="flex gap-2.5 text-sm text-ink-1">
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${tone === "can" ? "text-accent-ink" : "text-ink-3"}`} />
      <span>{children}</span>
    </li>
  );
}

export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (!supabaseEnv()) {
    return (
      <div className="mx-auto max-w-md pt-2 sm:pt-8">
        <Card>
          <EmptyState icon={CloudOff} title="Accounts are coming to Prism" body="Connecting AI apps needs a Prism account, and accounts aren't switched on here yet." />
        </Card>
      </div>
    );
  }
  const id = typeof params.authorization_id === "string" ? params.authorization_id : "";
  if (!AUTHORIZATION_ID.test(id)) {
    return <Problem title="This link is missing its request" body="Start again from the app you're connecting: add Prism there, and it will send you back here." />;
  }

  const account = await currentAccount();
  if (!account) redirect(`/sign-in?next=${encodeURIComponent(`/oauth/consent?authorization_id=${id}`)}`);

  const { data, error } = await account.supabase.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) {
    return <Problem title="This request has expired" body="Connection requests last a few minutes and work once. Go back to the app and connect Prism again." />;
  }
  // Already allowed earlier: straight back to the app.
  if (!("authorization_id" in data)) redirect(data.redirect_url);

  // An app names itself, so its name is kept short and never outranks the checkable part: where you'll be sent back to.
  const given = data.client.name?.replace(/\s+/g, " ").trim() || "An app";
  const name = given.length > 32 ? `${given.slice(0, 31)}…` : given;
  const returnsTo = hostOf(data.redirect_uri);
  const scopes = new Set(data.scope.split(" ").filter(Boolean));
  const problem = params.problem === "1";

  return (
    <div className="mx-auto max-w-md pt-2 sm:pt-8">
      <Card className="p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <PrismMark className="size-10" />
          <span aria-hidden className="text-ink-3">
            ⇄
          </span>
          <div aria-hidden className="grid size-10 place-items-center rounded-card bg-surface-3 text-lg font-bold text-ink-1">
            {name.slice(0, 1).toUpperCase()}
          </div>
        </div>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink-1">Let {name} read your money?</h1>
        <p className="mt-1 text-sm text-ink-2">
          {name} wants to connect to your {BRAND.product} account ({account.email ?? "you"}) so you can ask it about your spending, bills and goals.
        </p>
        {returnsTo ? (
          <p className="mt-4 rounded-ctl bg-surface-2 px-3 py-2 text-sm text-ink-1">
            If you allow it, you&apos;ll go back to <span className="font-bold">{returnsTo}</span>. Only allow apps you trust, and only if you started this from that
            app.
          </p>
        ) : null}

        <h2 className="mt-5 text-[13px] font-semibold text-ink-2">It will be able to</h2>
        <ul className="mt-2 space-y-2">
          <Line icon={Landmark} tone="can">
            See your accounts and balances
          </Line>
          <Line icon={Search} tone="can">
            Search your transactions
          </Line>
          <Line icon={CalendarClock} tone="can">
            See your spending, budgets, goals and upcoming bills
          </Line>
          {scopes.has("email") ? (
            <Line icon={Mail} tone="can">
              See your email address
            </Line>
          ) : null}
        </ul>

        <h2 className="mt-5 text-[13px] font-semibold text-ink-2">It will never be able to</h2>
        <ul className="mt-2 space-y-2">
          <Line icon={Ban} tone="cannot">
            Move money or pay anyone
          </Line>
          <Line icon={PencilOff} tone="cannot">
            Change or delete anything in {BRAND.product} — the database itself refuses
          </Line>
          <Line icon={KeyRound} tone="cannot">
            See your bank or Coinbase sign-in details
          </Line>
        </ul>

        {problem ? (
          <p role="alert" className="mt-5 text-sm font-medium text-crit-ink">
            That didn&apos;t go through. Try again, or start over from the app.
          </p>
        ) : null}

        <form action={decideConnection}>
          <input type="hidden" name="authorization_id" value={data.authorization_id} />
          <ConsentButtons appName={name.length > 20 ? "it" : name} />
        </form>
        <p className="mt-4 text-center text-xs text-ink-3">You can disconnect it any time from your Account page.</p>
      </Card>
    </div>
  );
}
