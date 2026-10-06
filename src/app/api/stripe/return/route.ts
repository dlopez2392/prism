// GET /api/stripe/return?session=cs_… — where Checkout sends someone who
// just subscribed. Their subscription is read from Stripe and kept at once,
// so Prism Plus is open the moment they land, whether or not Stripe's webhook
// got here first. Only for the person the Checkout was made for (its
// client_reference_id): anyone else's session id changes nothing. Then on to
// the Account page, which says welcome. Any problem lands there too, saying it's on
// its way: the webhook keeps the subscription in a moment either way.

import { NextResponse } from "next/server";
import { billingConfig, syncSubscription } from "@/lib/billing/plus";
import { readCheckout } from "@/lib/billing/stripe";
import { requestOrigin } from "@/lib/server/origin";
import { currentAccount } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const origin = await requestOrigin();
  const go = (path: string) => NextResponse.redirect(new URL(path, origin), 303);
  const account = await currentAccount();
  if (!account) return go("/sign-in?next=/account");
  const config = billingConfig();
  const id = new URL(req.url).searchParams.get("session") ?? "";
  if (!config) return go("/account");
  try {
    const session = await readCheckout(config, id);
    if (session?.client_reference_id === account.userId && session.status === "complete" && session.subscription) {
      await syncSubscription(config, session.subscription, account.userId);
      return go("/account?plus=welcome#plan");
    }
  } catch (e) {
    console.error("Prism Plus: a finished Checkout wasn't read back:", e instanceof Error ? e.message : "unknown error");
  }
  return go("/account?plus=pending#plan");
}
