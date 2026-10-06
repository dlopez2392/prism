// src/components/your-plan.tsx
//
// "Your plan" on the Account page (#plan), while billing is on: what the
// person has, in words, with the date that matters next (the trial's end, the
// renewal, or the end of a cancelled plan) and the one way to change it.
// Managing a plan is Stripe's own page (/api/stripe/portal); starting one is
// the pricing page. Server-safe.

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { plusStartLine } from "@/components/plus";
import { ButtonLink, CardHeader, StatusPill } from "@/components/ui";
import { buttonGhost } from "@/components/dialog";
import { priceLabel, PRICES } from "@/lib/billing/plans";
import type { Plus } from "@/lib/billing/plus";
import { BRAND } from "@/lib/brand";
import { shortDate } from "@/lib/finance/format";
import type { T } from "@/lib/i18n/t";

/** What came back from Stripe's pages, said once at the top of the card. */
const RETURNS: Record<string, "good" | "neutral" | "warn"> = { welcome: "good", pending: "neutral", "portal-down": "warn" };

function returned(key: string, t: T): string {
  return key === "welcome"
    ? t("Welcome to {plus}. Everything is open.", { plus: BRAND.plus })
    : key === "pending"
      ? t("Stripe is still confirming your subscription. It shows here in a minute.")
      : t("Stripe's page didn't open just now. Try again in a minute.");
}

const day = (iso: string | null, t: T) => (iso ? `${shortDate(iso.slice(0, 10), t.locale)}, ${iso.slice(0, 4)}` : "");

/** The one line under the plan's name: when it next charges, ends or needs a card. */
function when(plus: Plus, t: T): string {
  const own = plus.own!;
  const price = priceLabel(PRICES[own.plan][own.interval]);
  if (own.status === "past_due") return t("Your last payment didn't go through. Update your card so nothing pauses.");
  if (own.endsAt) return t("Cancelled: it ends on {date}, and you keep everything until then.", { date: day(own.endsAt, t) });
  if (own.status === "trialing" && own.trialEnd) {
    return own.interval === "month"
      ? t("Free until {date}, then {price} a month.", { date: day(own.trialEnd, t), price })
      : t("Free until {date}, then {price} a year.", { date: day(own.trialEnd, t), price });
  }
  return own.interval === "month"
    ? t("Renews on {date} at {price} a month.", { date: day(own.periodEnd, t), price })
    : t("Renews on {date} at {price} a year.", { date: day(own.periodEnd, t), price });
}

export function YourPlan({ plus, back, t }: { plus: Plus; back: string | null; t: T }) {
  const own = plus.own;
  const name = own?.plan === "household" ? t("{plus} for your household", { plus: BRAND.plus }) : BRAND.plus;
  return (
    <>
      <CardHeader
        title={t("Your plan")}
        subtitle={
          own?.counts
            ? name
            : plus.covered
              ? t("Your household's plan gives you {plus}.", { plus: BRAND.plus })
              : t("Free: spending, budgets, goals and one bank. {plus} adds every other account, alerts, your household and more.", { plus: BRAND.plus })
        }
        action={
          own?.counts ? (
            <StatusPill status={own.status === "past_due" ? "warn" : "good"}>
              <Sparkles aria-hidden className="size-3.5" />
              {BRAND.plus}
            </StatusPill>
          ) : undefined
        }
      />
      {back && RETURNS[back] ? (
        <p role="status" className="mt-3">
          <StatusPill status={RETURNS[back]!} className="px-3 py-1.5 text-sm">
            {returned(back, t)}
          </StatusPill>
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {own?.counts ? (
          <>
            <p className="min-w-0 flex-1 basis-60 text-sm text-ink-2">{when(plus, t)}</p>
            <a href="/api/stripe/portal" className={buttonGhost}>
              {t("Manage your plan")}
            </a>
          </>
        ) : plus.covered ? (
          <Link href="/pricing" className="text-sm font-semibold text-accent-ink underline-offset-2 hover:underline">
            {t("See what's included")}
          </Link>
        ) : (
          <>
            <p className="min-w-0 flex-1 basis-60 text-sm text-ink-2">
              {own && own.endsAt ? `${t("Your {plus} ended on {date}.", { plus: BRAND.plus, date: day(own.endsAt, t) })} ` : ""}
              {plusStartLine(plus.trial, t)}
            </p>
            <ButtonLink href="/pricing" variant="primary">
              {t("See {plus}", { plus: BRAND.plus })}
            </ButtonLink>
            {plus.customerId ? (
              <a href="/api/stripe/portal" className="text-sm font-semibold text-accent-ink underline-offset-2 hover:underline">
                {t("Receipts and past payments")}
              </a>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
