"use client";

// src/components/pricing.tsx
//
// The plans side by side (/pricing): Free, Prism Plus and Plus for a
// household, by the month or by the year. Plus is the screen's one hero card
// and holds its one primary action; the others are ghost buttons. Subscribing
// goes to Stripe's Checkout through `startPlus`, which reads the plan and
// interval again and checks Stripe's price against the one shown here.

import { useActionState, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Check, Sparkles, Users } from "lucide-react";
import { buttonGhost } from "@/components/dialog";
import { useT } from "@/components/locale";
import { FREE_LINES, HOUSEHOLD_SEATS, PLUS_LINES, priceLabel, PRICES, TRIAL_DAYS, yearlySaving, type Interval, type PlanId } from "@/lib/billing/plans";
import { BRAND } from "@/lib/brand";
import { startPlus, type BillingFormState } from "@/lib/server/billing-actions";

export type PricingState = {
  /** Billing is on: the buttons subscribe. Off, the plans are shown and everything is free for now. */
  billing: boolean;
  signedIn: boolean;
  /** What they have: nothing yet, their own plan, or a household member's Household plan. */
  has: "free" | "plus" | "household" | "covered";
  /** A first subscription would start with the free days. */
  trial: boolean;
};

const IDLE: BillingFormState = { message: null };

function Lines({ lines, hero = false }: { lines: readonly string[]; hero?: boolean }) {
  const t = useT();
  return (
    <ul className="mt-4 space-y-2.5 text-sm">
      {lines.map((line) => (
        <li key={line} className="flex items-start gap-2">
          <Check aria-hidden className={clsx("mt-0.5 size-4 shrink-0", hero ? "text-[var(--on-hero)]" : "text-good")} strokeWidth={2.5} />
          <span>{t(line)}</span>
        </li>
      ))}
    </ul>
  );
}

function Price({ plan, interval, hero = false }: { plan: PlanId; interval: Interval; hero?: boolean }) {
  const t = useT();
  const cents = PRICES[plan][interval];
  return (
    <div className="mt-3 flex items-baseline gap-1.5">
      <span className="text-4xl font-extrabold tracking-tight">{priceLabel(cents)}</span>
      <span className={clsx("text-sm font-semibold", hero ? "text-[var(--on-hero-soft)]" : "text-ink-3")}>{interval === "month" ? t("a month") : t("a year")}</span>
    </div>
  );
}

export function Pricing({ state }: { state: PricingState }) {
  const t = useT();
  const [interval, setBilled] = useState<Interval>("year");
  const [result, action, pending] = useActionState(startPlus, IDLE);
  const start = state.trial ? t("Start your {n} days free", { n: TRIAL_DAYS }) : t("Subscribe");

  /** The way into a plan from where the person stands: sign in, subscribe, manage what they have, or nothing yet. */
  function cta(plan: PlanId, hero: boolean) {
    const style = hero
      ? "inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-ctl bg-[var(--on-hero)] px-4 text-sm font-semibold text-[var(--button)] transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
      : clsx(buttonGhost, "w-full");
    if (!state.billing) return <p className={clsx("text-center text-xs font-semibold", hero ? "text-[var(--on-hero-soft)]" : "text-ink-3")}>{t("Free for everyone while {plus} gets ready.", { plus: BRAND.plus })}</p>;
    if (!state.signedIn) {
      return (
        <Link href="/sign-in?next=/pricing" className={style}>
          {t("Sign in to start")}
        </Link>
      );
    }
    if (state.has === plan) {
      return (
        <a href="/api/stripe/portal" className={style}>
          {t("Manage your plan")}
        </a>
      );
    }
    if (state.has === "covered" && plan === "plus") {
      return <p className={clsx("text-center text-xs font-semibold", hero ? "text-[var(--on-hero-soft)]" : "text-ink-3")}>{t("Your household's plan already gives you {plus}.", { plus: BRAND.plus })}</p>;
    }
    // Someone with the other plan switches on Stripe's page, which moves the one subscription they have.
    if (state.has === "plus" || state.has === "household") {
      return (
        <a href="/api/stripe/portal" className={style}>
          {t("Switch plans")}
        </a>
      );
    }
    return (
      <form action={action}>
        <input type="hidden" name="plan" value={plan} />
        <input type="hidden" name="interval" value={interval} />
        <button type="submit" disabled={pending} className={style}>
          {pending ? t("Opening secure checkout…") : start}
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-center">
        <div role="group" aria-label={t("Billed")} className="inline-flex h-10 items-center rounded-pill border border-line bg-surface-2 p-0.5 text-sm font-semibold">
          {(["month", "year"] as const).map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={interval === i}
              onClick={() => setBilled(i)}
              className={clsx("h-9 rounded-pill px-4 transition-colors duration-150", interval === i ? "bg-surface-1 text-ink-1 shadow-card" : "text-ink-3 hover:text-ink-1")}
            >
              {i === "month" ? t("Monthly") : t("Yearly · save up to {n}%", { n: Math.max(yearlySaving("plus"), yearlySaving("household")) })}
            </button>
          ))}
        </div>
      </div>

      {result.message ? (
        <p role="alert" className="mx-auto max-w-xl rounded-ctl bg-surface-2 px-3 py-2 text-center text-sm font-medium text-crit-ink">
          {result.message}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section aria-labelledby="plan-free" className="fade-up flex flex-col rounded-card border border-line bg-surface-1 p-5 shadow-card sm:p-6">
          <h2 id="plan-free" className="text-lg font-extrabold tracking-tight">
            {t("Free")}
          </h2>
          <p className="mt-1 text-sm text-ink-2">{t("See where your money goes, for good.")}</p>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-4xl font-extrabold tracking-tight">$0</span>
          </div>
          <Lines lines={FREE_LINES} />
          <div className="mt-auto pt-6">
            {state.billing && state.signedIn && state.has === "free" ? (
              <p className="text-center text-xs font-semibold text-ink-3">{t("Your plan today")}</p>
            ) : state.billing && !state.signedIn ? (
              <Link href="/sign-in?next=/pricing" className={clsx(buttonGhost, "w-full")}>
                {t("Start free")}
              </Link>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="plan-plus" data-hero="" className="fade-up flex flex-col rounded-card bg-prism p-5 text-[var(--on-hero)] shadow-hero sm:p-6">
          <h2 id="plan-plus" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <Sparkles aria-hidden className="size-5" />
            {BRAND.plus}
          </h2>
          <p className="mt-1 text-sm text-[var(--on-hero-soft)]">{t("Everything {product} does, for every account you have.", { product: BRAND.product })}</p>
          <Price plan="plus" interval={interval} hero />
          <Lines lines={PLUS_LINES} hero />
          <div className="mt-auto pt-6">{cta("plus", true)}</div>
        </section>

        <section aria-labelledby="plan-household" className="fade-up flex flex-col rounded-card border border-line bg-surface-1 p-5 shadow-card sm:p-6">
          <h2 id="plan-household" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <Users aria-hidden className="size-5 text-accent" />
            {t("{plus} for your household", { plus: BRAND.plus })}
          </h2>
          <p className="mt-1 text-sm text-ink-2">{t("Everything in {plus}, for up to {n} people who share a household.", { plus: BRAND.plus, n: HOUSEHOLD_SEATS })}</p>
          <Price plan="household" interval={interval} />
          <Lines
            lines={[
              t("Every member gets all of {plus}", { plus: BRAND.plus }),
              t("Each of you keeps your own sign-in, and shares only what you choose"),
              t("Budgets and goals you keep together"),
            ]}
          />
          <div className="mt-auto pt-6">{cta("household", false)}</div>
        </section>
      </div>
    </div>
  );
}
