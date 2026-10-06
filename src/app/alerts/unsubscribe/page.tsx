// src/app/alerts/unsubscribe/page.tsx — where an alert email's "Stop these
// emails" link lands. Opening the link changes nothing (mail scanners open
// links too); the button does, by posting to /api/alerts/unsubscribe, which
// checks the link's token. No sign-in needed: the link is the proof.

import type { Metadata } from "next";
import Link from "next/link";
import { BellOff, CircleCheck, CircleAlert } from "lucide-react";
import { buttonGhost, buttonPrimary } from "@/components/dialog";
import { PrismMark } from "@/components/shell";
import { Card } from "@/components/ui";
import { alertsConfig, unsubscribeFor } from "@/lib/alerts/send";
import { BRAND } from "@/lib/brand";
import { getT } from "@/lib/i18n/server";
import { supabaseEnv } from "@/lib/supabase/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Stop alert emails"), robots: { index: false } };
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<Params> }) {
  const t = await getT();
  const params = await searchParams;
  const config = alertsConfig();
  const u = one(params.u);
  const token = one(params.t);
  // The button is offered only where /api/alerts/unsubscribe can act on it.
  const valid = config !== null && supabaseEnv() !== null && unsubscribeFor(u, token, config.secret) !== null;
  const account = (
    <Link href="/account#alerts" className={buttonGhost}>
      {t("Open your Account page")}
    </Link>
  );

  let icon = <BellOff aria-hidden className="size-5 text-accent-ink" />;
  let title = t("Stop alert emails?");
  let body = t(
    "{product} will stop emailing you alerts and Monday summaries. Your accounts, budgets and goals stay exactly as they are, and you can turn emails back on from your Account page.",
    { product: BRAND.product },
  );
  let action = valid ? (
    <form method="post" action={`/api/alerts/unsubscribe?u=${encodeURIComponent(u!)}&t=${encodeURIComponent(token!)}`}>
      <input type="hidden" name="from" value="page" />
      <button type="submit" className={buttonPrimary}>
        {t("Stop alert emails")}
      </button>
    </form>
  ) : (
    account
  );
  if (one(params.done)) {
    icon = <CircleCheck aria-hidden className="size-5 text-good-ink" />;
    title = t("Alert emails are off");
    body = t("{product} won't email you alerts any more. If you change your mind, turn them back on from your Account page.", { product: BRAND.product });
    action = account;
  } else if (one(params.failed)) {
    icon = <CircleAlert aria-hidden className="size-5 text-crit-ink" />;
    title = t("That didn't go through");
    body = t("We couldn't reach your account just now, so your alert emails are still on. Try the link again in a minute, or turn them off from your Account page.");
    action = account;
  } else if (!valid) {
    icon = <CircleAlert aria-hidden className="size-5 text-crit-ink" />;
    title = t("This link doesn't work");
    body = t("It may have been cut short by your email app. Sign in and turn alert emails off from your Account page instead.");
  }

  return (
    <div className="mx-auto max-w-md pt-2 sm:pt-8">
      <Card className="p-6 sm:p-8">
        <PrismMark className="size-10" />
        <h1 className="mt-4 flex items-center gap-2 text-2xl font-extrabold tracking-tight text-ink-1">
          {icon}
          {title}
        </h1>
        <p className="mt-2 mb-6 text-sm text-ink-2">{body}</p>
        {action}
      </Card>
    </div>
  );
}
