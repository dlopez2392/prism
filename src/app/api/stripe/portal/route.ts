// GET /api/stripe/portal — opens Stripe's customer portal for the signed-in
// person: change the card, see receipts, switch plans, or cancel. Only their
// own Stripe customer (from their own plan row), back to the Account page
// afterwards. Changes nothing itself; whatever they change there reaches
// Prism through the webhook.

import { NextResponse } from "next/server";
import { billingConfig, plusFor } from "@/lib/billing/plus";
import { createPortal } from "@/lib/billing/stripe";
import { getLocale } from "@/lib/i18n/server";
import { requestOrigin } from "@/lib/server/origin";
import { currentAccount } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const origin = await requestOrigin();
  const go = (path: string) => NextResponse.redirect(new URL(path, origin), 303);
  const account = await currentAccount();
  if (!account) return go("/sign-in?next=/account");
  const config = billingConfig();
  const plus = await plusFor(account);
  if (!config || !plus.customerId) return go("/pricing");
  try {
    return NextResponse.redirect(await createPortal(config, plus.customerId, `${origin}/account#plan`, await getLocale()), 303);
  } catch (e) {
    console.error("Prism Plus: the billing portal didn't open:", e instanceof Error ? e.message : "unknown error");
    return go("/account?plus=portal-down#plan");
  }
}
