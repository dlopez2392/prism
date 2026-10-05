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
import { getT } from "@/lib/i18n/server";
import { decideConnection } from "@/lib/server/connected-apps-actions";
import { supabaseEnv } from "@/lib/supabase/config";
import { currentAccount } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Connect an app") };
}

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
  const t = await getT();
  const params = await searchParams;
  if (!supabaseEnv()) {
    return (
      <div className="mx-auto max-w-md pt-2 sm:pt-8">
        <Card>
          <EmptyState icon={CloudOff} title={t("Accounts are coming to Prism")} body={t("Connecting AI apps needs a Prism account, and accounts aren't switched on here yet.")} />
        </Card>
      </div>
    );
  }
  const id = typeof params.authorization_id === "string" ? params.authorization_id : "";
  if (!AUTHORIZATION_ID.test(id)) {
    return <Problem title={t("This link is missing its request")} body={t("Start again from the app you're connecting: add Prism there, and it will send you back here.")} />;
  }

  const account = await currentAccount();
  if (!account) redirect(`/sign-in?next=${encodeURIComponent(`/oauth/consent?authorization_id=${id}`)}`);

  const { data, error } = await account.supabase.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) {
    return <Problem title={t("This request has expired")} body={t("Connection requests last a few minutes and work once. Go back to the app and connect Prism again.")} />;
  }
  // Already allowed earlier: straight back to the app.
  if (!("authorization_id" in data)) redirect(data.redirect_url);

  // An app names itself, so its name is kept short and never outranks the checkable part: where you'll be sent back to.
  const given = data.client.name?.replace(/\s+/g, " ").trim() || t("An app");
  const name = given.length > 32 ? `${given.slice(0, 31)}…` : given;
  const returnsTo = hostOf(data.redirect_uri);
  const scopes = new Set(data.scope.split(" ").filter(Boolean));
  const problem = params.problem === "1";
  // One sentence, with where they'll be sent back to in bold wherever the language puts it.
  const [beforeHost, afterHost] = t("If you allow it, you'll go back to {host}. Only allow apps you trust, and only if you started this from that app.").split("{host}");

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
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink-1">{t("Let {name} read your money?", { name })}</h1>
        <p className="mt-1 text-sm text-ink-2">
          {account.email !== null
            ? t("{name} wants to connect to your {product} account ({email}) so you can ask it about your spending, bills and goals.", { name, product: BRAND.product, email: account.email })
            : t("{name} wants to connect to your {product} account (you) so you can ask it about your spending, bills and goals.", { name, product: BRAND.product })}
        </p>
        {returnsTo ? (
          <p className="mt-4 rounded-ctl bg-surface-2 px-3 py-2 text-sm text-ink-1">
            {beforeHost}
            <span className="font-bold">{returnsTo}</span>
            {afterHost}
          </p>
        ) : null}

        <h2 className="mt-5 text-[13px] font-semibold text-ink-2">{t("It will be able to")}</h2>
        <ul className="mt-2 space-y-2">
          <Line icon={Landmark} tone="can">
            {t("See your accounts and balances")}
          </Line>
          <Line icon={Search} tone="can">
            {t("Search your transactions")}
          </Line>
          <Line icon={CalendarClock} tone="can">
            {t("See your spending, budgets, goals and upcoming bills")}
          </Line>
          {scopes.has("email") ? (
            <Line icon={Mail} tone="can">
              {t("See your email address")}
            </Line>
          ) : null}
        </ul>

        <h2 className="mt-5 text-[13px] font-semibold text-ink-2">{t("It will never be able to")}</h2>
        <ul className="mt-2 space-y-2">
          <Line icon={Ban} tone="cannot">
            {t("Move money or pay anyone")}
          </Line>
          <Line icon={PencilOff} tone="cannot">
            {t("Change or delete anything in {product} — the database itself refuses", { product: BRAND.product })}
          </Line>
          <Line icon={KeyRound} tone="cannot">
            {t("See your bank or Coinbase sign-in details")}
          </Line>
        </ul>

        {problem ? (
          <p role="alert" className="mt-5 text-sm font-medium text-crit-ink">
            {t("That didn't go through. Try again, or start over from the app.")}
          </p>
        ) : null}

        <form action={decideConnection}>
          <input type="hidden" name="authorization_id" value={data.authorization_id} />
          {/* A long name doesn't fit a button: there it's "Allow it". */}
          <ConsentButtons appName={name.length > 20 ? null : name} />
        </form>
        <p className="mt-4 text-center text-xs text-ink-3">{t("You can disconnect it any time from your Account page.")}</p>
      </Card>
    </div>
  );
}
