// src/lib/server/health.ts
//
// What /api/health reports: is Prism up, which release is live, and did the
// daily alert job run? Read by the production check (.github/workflows/
// production-check.yml), which opens an issue for the owner when it isn't.
//
// Public on purpose and says nothing about anyone: the release's short commit
// (the repository is public), whether the database answers, and when each
// scheduled job last ran and whether that run finished (job_health). Answers
// are reused for 30 seconds, so a flood of requests costs the database little.

import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/supabase/config";

export type Health = {
  ok: boolean;
  commit: string | null;
  database: "ok" | "unreachable" | "not_configured";
  jobs: Record<string, { last_run: string; ok: boolean }>;
};

const REUSE_MS = 30_000;
let last: { at: number; health: Health } | null = null;

async function check(): Promise<Health> {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  const commit = sha && /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 7) : null;
  const env = supabaseEnv();
  if (!env) return { ok: true, commit, database: "not_configured", jobs: {} };
  const db = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  try {
    const { data, error } = await db.rpc("job_health").abortSignal(AbortSignal.timeout(5_000));
    if (error || !Array.isArray(data)) return { ok: false, commit, database: "unreachable", jobs: {} };
    const jobs: Health["jobs"] = {};
    for (const r of data as { name: unknown; ran_at: unknown; ok: unknown }[]) {
      if (typeof r.name === "string" && typeof r.ran_at === "string" && typeof r.ok === "boolean") jobs[r.name] = { last_run: r.ran_at, ok: r.ok };
    }
    return { ok: true, commit, database: "ok", jobs };
  } catch {
    return { ok: false, commit, database: "unreachable", jobs: {} };
  }
}

/** The current answer, reused for 30 seconds. */
export async function health(now = Date.now()): Promise<Health> {
  if (!last || now - last.at > REUSE_MS) last = { at: now, health: await check() };
  return last.health;
}

/** For tests: forget the reused answer. */
export function forgetHealth() {
  last = null;
}
