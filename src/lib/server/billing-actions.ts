"use server";

// src/lib/server/billing-actions.ts
//
// Subscribing to Prism Plus, and managing it, both on Stripe's own pages
// (Checkout and the customer portal): Prism never takes a card. The plan and
// interval come from the form and are read again here; the price is Stripe's,
// checked against the one the pricing page shows before anyone is sent to
// pay it (`priceProblem`).

import { redirect } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { billingConfig, plusFor } from "@/lib/billing/plus";
import { LOOKUP_KEYS, type Interval, type PlanId } from "@/lib/billing/plans";
import { createCheckout, priceProblem, sellingPrices } from "@/lib/billing/stripe";
import { getT } from "@/lib/i18n/server";
import { currentAccount } from "@/lib/supabase/server";
import { requestOrigin } from "./origin";

export type BillingFormState = { message: string | null };

const isPlan = (x: unknown): x is PlanId => x === "plus" || x === "household";
const isInterval = (x: unknown): x is Interval => x === "month" || x === "year";

/** Sends the person to Stripe's Checkout for the plan they picked (or to manage the one they have). */
export async function startPlus(_prev: BillingFormState, form: FormData): Promise<BillingFormState> {
  const t = await getT();
  const plan = form.get("plan");
  const interval = form.get("interval");
  if (!isPlan(plan) || !isInterval(interval)) return { message: t("Choose a plan first.") };
  const account = await currentAccount();
  if (!account) redirect(`/sign-in?next=${encodeURIComponent("/pricing")}`);
  const config = billingConfig();
  if (!config) return { message: t("{plus} isn't available yet.", { plus: BRAND.plus }) };
  const plus = await plusFor(account);
  // Someone already subscribed changes plans on Stripe's page, which moves the one subscription they have.
  if (plus.own?.counts) redirect("/api/stripe/portal");
  if (plus.covered && plan === "plus") return { message: t("Your household's plan already gives you {plus}.", { plus: BRAND.plus }) };
  let url: string;
  try {
    const price = (await sellingPrices(config)).get(LOOKUP_KEYS[plan][interval]);
    const problem = priceProblem(price, plan, interval);
    if (problem) {
      // The owner's to fix in Stripe; the person is never sent to pay a price the page didn't show.
      console.error(`Prism Plus: checkout refused, ${problem}.`);
      return { message: t("Subscribing isn't working just now. Try again later.") };
    }
    url = await createCheckout(config, {
      userId: account.userId,
      email: account.email,
      customerId: plus.customerId,
      plan,
      interval,
      priceId: price!.id,
      trial: plus.trial,
      origin: await requestOrigin(),
      t,
    });
  } catch (e) {
    console.error("Prism Plus: Checkout didn't start:", e instanceof Error ? e.message : "unknown error");
    return { message: t("Subscribing isn't working just now. Try again later.") };
  }
  redirect(url);
}
