// POST /api/plaid/webhook — Plaid saying a linked bank has news.
//
// Believed only with Plaid's signature (src/lib/plaid/webhook.ts). Prism
// holds no privileged key, so the webhook can't sync anyone's bank itself —
// it can't read their token, by design — and it doesn't try: it stamps
// "news" on that bank (plaid_item_changed, which can touch nothing else), and
// keeps any warning about it (plaid_bank_warning_signed, with the jobs' secret: sign in again, consent
// ending on a date, access withdrawn; three plain columns and nothing else), and
// the person's own next visit, or their next question to a connected app,
// asks Plaid for exactly what changed. A non-200 makes Plaid retry.

import { createClient } from "@supabase/supabase-js";
import { MIN_SECRET } from "@/lib/alerts/send";
import { plaidConfig } from "@/lib/plaid/client";
import { bankWarning, isSyncWorthy, verifyPlaidWebhook } from "@/lib/plaid/webhook";
import { supabaseEnv } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

const MAX_BODY = 64 * 1024;

export async function POST(req: Request): Promise<Response> {
  const config = plaidConfig();
  const env = supabaseEnv();
  if (!config) return Response.json({ error: "not_configured" }, { status: 404 });

  // Too big is refused before it's read (by its stated length) and after (by what actually came).
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "too_large" }, { status: 413 });
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.byteLength > MAX_BODY) return Response.json({ error: "too_large" }, { status: 413 });
  // Plaid signs the exact bytes it sent, so they are checked before anything reads them.
  if (!(await verifyPlaidWebhook(config, req.headers.get("plaid-verification"), raw))) {
    return Response.json({ error: "unverified" }, { status: 401 });
  }

  let body: Parameters<typeof bankWarning>[0] & { item_id?: unknown };
  try {
    body = JSON.parse(new TextDecoder().decode(raw)) as typeof body;
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  // Device-only links have no row to flag; their next load reads the bank in full anyway.
  if (env && isSyncWorthy(body) && typeof body.item_id === "string") {
    const anon = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { error } = await anon.rpc("plaid_item_changed", { p_item_id: body.item_id });
    if (error) return Response.json({ error: "not_recorded" }, { status: 500 });
    // A warning (sign in again, consent ending, access withdrawn) is kept, so it can be shown before the next sync finds it.
    // The database keeps one only for the jobs' secret (plaid_bank_warning_signed), so nobody can set one without it.
    const warning = bankWarning(body);
    const secret = process.env.CRON_SECRET?.trim() ?? "";
    if (warning && secret.length >= MIN_SECRET) {
      const { error: notKept } = await anon.rpc("plaid_bank_warning_signed", { p_secret: secret, p_item_id: body.item_id, p_event: warning.event, p_at: warning.at });
      if (notKept) return Response.json({ error: "not_recorded" }, { status: 500 });
    } else if (warning) console.error("Prism: a bank's warning wasn't kept: CRON_SECRET isn't set here.");
  }
  return Response.json({ received: true });
}
