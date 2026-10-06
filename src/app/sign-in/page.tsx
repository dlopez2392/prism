// src/app/sign-in/page.tsx — sign in, or create an account, with a code by email.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CloudOff, Lock, Smartphone, Trash2 } from "lucide-react";
import { PrismMark } from "@/components/shell";
import { SignInForm } from "@/components/sign-in-form";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { supabaseEnv } from "@/lib/supabase/config";
import { connectReason } from "@/lib/linking";
import { safeNext } from "@/lib/profile";
import { awaitingSecondStep, currentAccount, twoStepPath } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Sign in") };
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getT();
  if (!supabaseEnv()) {
    return (
      <div>
        <PageHeader title={t("Sign in")} />
        <Card>
          <EmptyState
            icon={CloudOff}
            title={t("Accounts are coming to Prism")}
            body={t("For now everything you set up stays on this device — budgets, goals and linked accounts included.")}
          />
        </Card>
      </div>
    );
  }
  const params = await searchParams;
  const next = safeNext(params.next);
  // Sent here by "Connect a bank" or "Connect Coinbase" (src/lib/linking.ts): say why, and what it buys them.
  const reason = connectReason(params.why);
  if (await currentAccount()) redirect(next ?? "/account");
  if (await awaitingSecondStep()) redirect(twoStepPath(next));
  const linkError = params.error === "link";

  return (
    <div className="mx-auto max-w-md pt-2 sm:pt-8">
      <Card className="p-6 sm:p-8">
        <PrismMark className="size-10" />
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink-1">{t("Sign in to Prism")}</h1>
        <p className="mt-1 mb-6 text-sm text-ink-2">
          {next?.startsWith("/oauth/consent")
            ? t("Sign in first, then you'll choose whether to connect the app.")
            : reason === "coinbase"
              ? t("Sign in first, then connect Coinbase. It's kept in your account, where two-step sign-in can protect it and deleting your account removes it.")
              : reason === "investments"
                ? t("Sign in first, then connect your investment account. It's kept in your account, where two-step sign-in can protect it and deleting your account removes it.")
                : reason
                  ? t("Sign in first, then connect your bank. It's kept in your account, where two-step sign-in can protect it and deleting your account removes it.")
                  : t("Keep your banks, budgets and goals in one account, on every device.")}
        </p>
        <SignInForm linkError={linkError} next={next} />
      </Card>
      <ul className="mt-5 space-y-2.5 px-1 text-[13px] text-ink-2">
        <li className="flex gap-2.5">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-ink" />
          {t("Bank and Coinbase tokens stay encrypted; the database only ever holds ciphertext.")}
        </li>
        <li className="flex gap-2.5">
          <Smartphone aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-ink" />
          {t("Anything you set up on this device before signing in can come with you — you'll be asked first.")}
        </li>
        <li className="flex gap-2.5">
          <Trash2 aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-ink" />
          {t("Delete the account any time, and every link is revoked at the source.")}
        </li>
      </ul>
      <p className="mt-4 px-1 text-xs text-ink-3">
        {t("What Prism collects, who else sees it, and your choices:")}{" "}
        <Link href="/privacy" className="font-semibold text-accent-ink hover:underline">
          {t("Privacy policy")}
        </Link>
      </p>
    </div>
  );
}
