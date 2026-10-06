// POST /api/stripe/webhook — Stripe saying a subscription changed.
//
// Believed only with Stripe's signature over the exact bytes it sent
// (`verifyStripeSignature`), and even then not taken at its word: the event
// only names a subscription, which the server reads back from Stripe itself
// and keeps (`syncSubscription`), so events arriving late or out of order
// can't leave the wrong state behind. Kept through billing_record, which
// answers only to the job secret. A non-200 makes Stripe retry, for days.
//
// Events to send here (Stripe dashboard → Webhooks): checkout.session.completed,
// customer.subscription.created, customer.subscription.updated,
// customer.subscription.deleted. Anything else is acknowledged and ignored.

import { billingConfig, syncSubscription } from "@/lib/billing/plus";
import { subscriptionOf, verifyStripeSignature, type StripeEvent } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

const MAX_BODY = 512 * 1024;

export async function POST(req: Request): Promise<Response> {
  const config = billingConfig();
  if (!config) return Response.json({ error: "not_configured" }, { status: 404 });

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "too_large" }, { status: 413 });
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.byteLength > MAX_BODY) return Response.json({ error: "too_large" }, { status: 413 });
  if (!verifyStripeSignature(config.webhookSecret, req.headers.get("stripe-signature"), raw)) {
    return Response.json({ error: "unverified" }, { status: 401 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(new TextDecoder().decode(raw)) as StripeEvent;
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }
  // The other Stripe mode's events (a test key's endpoint sent to the live site) are none of this deployment's.
  if (event.livemode !== config.livemode) return Response.json({ received: true, ignored: "mode" });
  const about = typeof event.type === "string" ? subscriptionOf(event) : null;
  if (!about) return Response.json({ received: true, ignored: "type" });

  try {
    const outcome = await syncSubscription(config, about.id, about.user);
    return Response.json({ received: true, outcome });
  } catch (e) {
    // No customer or person in the message: Stripe keeps the event and sends it again.
    console.error("Prism Plus: a Stripe event wasn't recorded:", e instanceof Error ? e.message : "unknown error");
    return Response.json({ error: "not_recorded" }, { status: 500 });
  }
}
