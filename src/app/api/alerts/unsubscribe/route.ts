// POST /api/alerts/unsubscribe?u=<person>&t=<token> — stop someone's alert emails.
//
// Two callers: a mail app's one-click unsubscribe (RFC 8058; the email's
// List-Unsubscribe header points here and it posts List-Unsubscribe=One-Click),
// and the confirm button on /alerts/unsubscribe. Either way the token must be
// the one Prism signed for that person (src/lib/alerts/send.ts); then
// alerts_stop turns their emails off, which also deletes the snapshot kept
// for them. Nothing else about them is touched, and nobody needs to sign in.
// A plain GET does nothing here, so a link scanner can't unsubscribe anyone.

import { createClient } from "@supabase/supabase-js";
import { alertsConfig, unsubscribeFor } from "@/lib/alerts/send";
import { supabaseEnv } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

const MAX_BODY = 1024;
const PAGE = "/alerts/unsubscribe";

export async function POST(req: Request): Promise<Response> {
  const config = alertsConfig();
  const env = supabaseEnv();
  if (!config || !env) return Response.json({ error: "not_configured" }, { status: 404 });
  // Too big is refused before it's read (by its stated length) and after (by what actually came).
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "too_large" }, { status: 413 });
  const body = await req.text().catch(() => "");
  if (body.length > MAX_BODY) return Response.json({ error: "too_large" }, { status: 413 });
  const fromPage = new URLSearchParams(body).get("from") === "page";
  const back = (outcome: "done" | "failed" | "invalid") => Response.redirect(new URL(`${PAGE}?${outcome}=1`, config.site), 303);

  const url = new URL(req.url);
  const userId = unsubscribeFor(url.searchParams.get("u"), url.searchParams.get("t"), config.secret);
  if (!userId) return fromPage ? back("invalid") : Response.json({ error: "invalid_link" }, { status: 400 });

  const anon = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await anon.rpc("alerts_stop", { p_secret: config.secret, p_user_id: userId });
  if (error) return fromPage ? back("failed") : Response.json({ error: "not_stopped" }, { status: 500 });
  return fromPage ? back("done") : Response.json({ unsubscribed: true });
}
