// GET /api/cron/alerts — the daily alert email job (vercel.json, "crons").
//
// Vercel Cron calls it once a day with `Authorization: Bearer <CRON_SECRET>`;
// anyone else gets a 401, and a deployment without the secret, Resend, the
// database or the vault key (every preview) a 404. Prism holds no privileged
// key, so the job reads nobody's data as itself: the database answers it
// only for people who turned alert emails on, and only to the secret
// (src/lib/alerts/job.ts), and with billing on only for people with Prism
// Plus. The response and the log are counts, never names,
// and so is the run's record (job_ran), which /api/health reports on.

import { createClient } from "@supabase/supabase-js";
import { runAlertJob } from "@/lib/alerts/job";
import { billingConfig } from "@/lib/billing/plus";
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
  // Each run leaves its outcome (counts only) for /api/health, so a morning without it opens an issue.
  const ran = async (ok: boolean, report: Record<string, unknown>) => {
    const { error } = await anon.rpc("job_ran", { p_secret: config.secret, p_name: "alerts", p_ok: ok, p_report: report });
    if (error) console.error("Prism: the alert job's run wasn't recorded.");
  };
  try {
    const billing = billingConfig();
    const report = await runAlertJob(anon, config, key, { deadline: Date.now() + RUN_FOR_MS, billing: billing ? { livemode: billing.livemode } : null });
    console.log("Prism: alert emails", JSON.stringify(report));
    // Finished, unless Resend refused the key itself and the run stopped.
    await ran(!report.stopped, report);
    return Response.json(report);
  } catch {
    console.error("Prism: the alert email job couldn't start: the database didn't answer it.");
    await ran(false, { error: "not_run" });
    return Response.json({ error: "not_run" }, { status: 500 });
  }
}
