// POST /api/plaid/webhook — Plaid saying a linked bank has news.
//
// Believed only with Plaid's signature (src/lib/plaid/webhook.ts). Prism
// holds no privileged key, so the webhook can't sync anyone's bank itself —
// it can't read their token, by design — and it doesn't try: it stamps
// "news" on that bank (plaid_item_changed, which can touch nothing else), and
// the person's own next visit, or their next question to a connected app,
// asks Plaid for exactly what changed. A non-200 makes Plaid retry.

import { createClient } from "@supabase/supabase-js";
import { plaidConfig } from "@/lib/plaid/client";
import { isSyncWorthy, verifyPlaidWebhook } from "@/lib/plaid/webhook";
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

  let body: { webhook_type?: unknown; webhook_code?: unknown; item_id?: unknown };
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
  }
  return Response.json({ received: true });
}
