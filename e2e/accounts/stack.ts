// e2e/accounts/stack.ts — where the signed-in browser tests get a database:
// the LOCAL Supabase stack (`supabase start`, supabase/config.toml), and only
// that. Its address and publishable key are read from `supabase status`,
// which describes the containers on this machine and nothing else, and then
// checked: anything that isn't a loopback address, or that names production,
// is refused before a server starts or a page opens. The tests never need,
// read or pass on the stack's secret key; every account is made the way a
// person makes one, through the sign-in form.

import { execFileSync } from "node:child_process";

export type LocalStack = { url: string; key: string; mailpit: string };

/** Production's project ref. Nothing the tests are handed may name it. */
export const PRODUCTION_REF = "mstdtbckfdrtinaoslda";

/** Where a resolved stack is handed from the runner to its workers. */
const CACHE = "PRISM_E2E_STACK";

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$/;

/** The stack as `supabase status` describes it, refused unless it is plainly this machine's. */
export function checkedStack(raw: { API_URL?: unknown; PUBLISHABLE_KEY?: unknown; MAILPIT_URL?: unknown; INBUCKET_URL?: unknown }): LocalStack {
  const url = typeof raw.API_URL === "string" ? raw.API_URL.replace(/\/+$/, "") : "";
  const key = typeof raw.PUBLISHABLE_KEY === "string" ? raw.PUBLISHABLE_KEY : "";
  const mail = raw.MAILPIT_URL ?? raw.INBUCKET_URL;
  const mailpit = typeof mail === "string" ? mail.replace(/\/+$/, "") : "";
  if (!LOOPBACK.test(url)) throw new Error("The signed-in tests run only against the local Supabase stack, and its API address isn't a loopback address.");
  if (!LOOPBACK.test(mailpit)) throw new Error("The signed-in tests read sign-in codes only from the local stack's Mailpit, and its address isn't a loopback address.");
  if (!/^sb_publishable_[\w-]+$/.test(key)) throw new Error("The local stack didn't report a publishable key.");
  refuseProduction({ url, key, mailpit });
  return { url, key, mailpit };
}

/** Throws when any value names production's project, saying which, never the value. */
export function refuseProduction(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value?.includes(PRODUCTION_REF)) throw new Error(`Refusing to run browser tests: ${name} names Prism's production project.`);
  }
}

/**
 * The running local stack, or null when there isn't one (the signed-in tests
 * are then left out, with a note). In CI it must be there: a run that quietly
 * skipped them would pass without testing anything signed in.
 */
export function localStack(env: Record<string, string | undefined> = process.env): LocalStack | null {
  const cached = env[CACHE];
  if (cached) return checkedStack(JSON.parse(cached));
  let out: string;
  try {
    out = execFileSync("supabase", ["status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  } catch {
    if (env.CI) throw new Error("The signed-in browser tests need the local Supabase stack. Run `supabase start` before `pnpm test:e2e`.");
    console.warn("[e2e] No local Supabase stack (`supabase start`), so the signed-in tests are left out of this run.");
    return null;
  }
  // The CLI may print a line or two before the JSON.
  const stack = checkedStack(JSON.parse(out.slice(out.indexOf("{"))));
  env[CACHE] = JSON.stringify({ API_URL: stack.url, PUBLISHABLE_KEY: stack.key, MAILPIT_URL: stack.mailpit });
  return stack;
}
