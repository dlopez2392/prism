// GET /api/cron/alerts — the daily alert email job (vercel.json, "crons").
//
// Vercel Cron calls it once a day with `Authorization: Bearer <CRON_SECRET>`;
// anyone else gets a 401, and a deployment without the secret, Resend, the
// database or the vault key (every preview) a 404. Prism holds no privileged
// key, so the job reads nobody's data as itself: the database answers it
// only for people who turned alert emails on, and only to the secret
// (src/lib/alerts/job.ts). The response and the log are counts, never names.

import { createClient } from "@supabase/supabase-js";
import { runAlertJob } from "@/lib/alerts/job";
import { alertsConfig, cronAllowed } from "@/lib/alerts/send";
import { vaultKey, type Keyring } from "@/lib/server/vault";
import { supabaseEnv } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Stop starting new emails this long into the run, inside the function's 60 seconds. */
const RUN_FOR_MS = 45_000;

export async function GET(req: Request): Promise<Response> {
  const config = alertsConfig();
  const env = supabaseEnv();
  let key: Keyring | null = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  if (!config || !env || !key) return Response.json({ error: "not_configured" }, { status: 404 });
  if (!cronAllowed(req.headers.get("authorization"), config.secret)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const anon = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  try {
    const report = await runAlertJob(anon, config, key, { deadline: Date.now() + RUN_FOR_MS });
    console.log("Prism: alert emails", JSON.stringify(report));
    return Response.json(report);
  } catch {
    console.error("Prism: the alert email job couldn't start: the database didn't answer it.");
    return Response.json({ error: "not_run" }, { status: 500 });
  }
}
