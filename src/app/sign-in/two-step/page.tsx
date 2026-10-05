// src/app/sign-in/two-step/page.tsx — the second step of signing in, for
// someone who turned on two-step sign-in: the code from their authenticator
// app, after the one from their email. Until it's entered, the database keeps
// their account closed, so every other page treats them as signed out.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PrismMark } from "@/components/shell";
import { SignOutButton } from "@/components/sign-in-form";
import { TwoStepForm } from "@/components/two-step";
import { Card } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { safeNext } from "@/lib/profile";
import { signOut } from "@/lib/server/auth-actions";
import { supabaseEnv } from "@/lib/supabase/config";
import { awaitingSecondStep, currentAccount } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Finish signing in"), robots: { index: false } };
}

export default async function TwoStepPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getT();
  const next = safeNext((await searchParams).next);
  if (await currentAccount()) redirect(next ?? "/");
  const account = await awaitingSecondStep();
  if (!account) redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  // The authenticator to check comes from the database. The browser checks the code itself (lib/supabase/browser.ts).
  const { data: factorId } = await account.supabase.rpc("my_second_step_factor");
  const env = supabaseEnv();

  return (
    <div className="mx-auto max-w-md pt-2 sm:pt-8">
      <Card className="p-6 sm:p-8">
        <PrismMark className="size-10" />
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink-1">{t("One more step")}</h1>
        <p className="mt-1 mb-6 text-sm text-ink-2">
          {account.email ? `${t("{email} has two-step sign-in on.", { email: account.email })} ` : null}
          {t("Open your authenticator app and enter the 6-digit code it shows for {product}.", { product: BRAND.product })}
        </p>
        {typeof factorId === "string" && env ? (
          <TwoStepForm next={next} factorId={factorId} supabase={env} />
        ) : (
          <p role="alert" className="text-sm font-medium text-crit-ink">
            {t("We couldn't load your sign-in check just now. Reload this page in a minute.")}
          </p>
        )}
      </Card>
      <div className="mt-5 space-y-3 px-1 text-[13px] text-ink-2">
        <p>
          {t("Lost your phone? If you saved your set-up key, add it to a new authenticator app. If not, email")}{" "}
          <a href={`mailto:${BRAND.privacyEmail}`} className="font-semibold text-accent-ink hover:underline">
            {BRAND.privacyEmail}
          </a>{" "}
          {t("from this address and we'll help you back in.")}
        </p>
        <div className="flex items-center gap-3">
          <span>{t("Not you, or a different account?")}</span>
          <SignOutButton action={signOut} />
        </div>
      </div>
    </div>
  );
}
