// src/app/pricing/page.tsx — Prism Plus: what's free, what Plus adds, and
// what each costs, by the month or by the year (billing/plans.ts). Reached
// from wherever someone on the free plan meets a part of Plus (`?need=` names
// which, and says so at the top), from the Account page, and from the
// sidebar. With billing off it still shows the plans, and says everything is
// free for now; nothing can be bought.
//
// Hero (the one --gradient-prism card): Prism Plus itself, in components/pricing.tsx.

import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, Sparkles } from "lucide-react";
import { Pricing, type PricingState } from "@/components/pricing";
import { PageHeader, StatusPill } from "@/components/ui";
import { FOUNDING_OFFER, isPlusFeature, plusNeeds } from "@/lib/billing/plans";
import { plusFor, type Plus } from "@/lib/billing/plus";
import { BRAND } from "@/lib/brand";
import { getT } from "@/lib/i18n/server";
import { currentAccount } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  const plus = await plusFor(await currentAccount());
  // Until billing is switched on, the page is there to see, not to find.
  return { title: BRAND.plus, description: t("Everything {product} does, for every account you have.", { product: BRAND.product }), ...(plus.billing ? {} : { robots: { index: false } }) };
}

function has(p: Plus): PricingState["has"] {
  if (p.own?.counts) return p.own.plan;
  return p.covered ? "covered" : "free";
}

export default async function PricingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [t, account] = await Promise.all([getT(), currentAccount()]);
  const plus = await plusFor(account);
  const need = (await searchParams).need;
  const state: PricingState = { billing: plus.billing, signedIn: account !== null, has: plus.billing ? has(plus) : "free", trial: plus.trial };

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("Plans")} title={BRAND.plus} subtitle={t("Everything {product} does, for every account you have.", { product: BRAND.product })} />
      {isPlusFeature(need) && plus.billing && !plus.plus ? (
        <p role="status" className="-mt-2">
          <StatusPill status="neutral" className="px-3 py-1.5 text-sm">
            <Sparkles aria-hidden className="size-4" />
            {plusNeeds(need, t)}
          </StatusPill>
        </p>
      ) : null}
      {FOUNDING_OFFER && plus.billing ? (
        <p className="text-center text-sm font-semibold text-ink-2">{t("Founding-member prices: the price you start at stays yours for as long as you stay subscribed.")}</p>
      ) : null}

      <Pricing state={state} />

      <div className="mx-auto max-w-2xl space-y-2 text-center text-xs text-ink-3">
        <p>
          {t("Prices are in US dollars, plus sales tax where it applies. A plan renews by itself until you cancel, and you can cancel any time on your Account page; you keep it until the end of the time you've paid for.")}
        </p>
        <p className="inline-flex items-center gap-1.5">
          <ShieldCheck aria-hidden className="size-3.5" />
          {t("Payments are handled by Stripe. {product} never sees your card.", { product: BRAND.product })}{" "}
          <Link href="/terms#cost" className="font-semibold text-ink-2 hover:underline">
            {t("Terms of Service")}
          </Link>
        </p>
      </div>
    </div>
  );
}
