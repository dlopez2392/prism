// src/lib/ops/production-check.ts
//
// Is production working? After every production deploy, and every six hours,
// GitHub Actions runs this against the live site
// (.github/workflows/production-check.yml); when anything fails it opens an
// issue (GitHub emails the owner), and closes it when everything passes
// again. It reads only what anyone on the internet can: pages, headers, the
// doors that must stay shut, /api/health and the certificate. It holds no
// secret and signs in as nobody.
//
// The repository is public, and so are its issues and Actions logs: a door
// found open must not be announced there. With --public (the workflow), a
// failing protective check is reported only as that, with no name or detail;
// run it without the flag, from a private terminal, to see which and why.
//
// Self-contained on purpose: Node runs this file as TypeScript (no install,
// no build), so it imports nothing but Node's own modules.
//
//   node src/lib/ops/production-check.ts --base https://prism.bis-rgv.com \
//     [--commit <sha>] [--report report.md] [--summary "$GITHUB_STEP_SUMMARY"] [--public]

import { appendFileSync, writeFileSync } from "node:fs";
import { connect } from "node:tls";
import { pathToFileURL } from "node:url";

/** `sensitive`: a failure here is a door open to strangers, never to be described in public. */
export type Check = { name: string; ok: boolean; detail: string; fix?: string; sensitive?: true };

/** A morning's run can land up to an hour late; past this, a run was missed. */
export const JOB_STALE_HOURS = 26;
/** Vercel renews certificates well before this; fewer days left means renewal is failing. */
export const CERT_MIN_DAYS = 14;

type Options = {
  /** The release this check is for: /api/health must name it. */
  commit?: string | null;
  fetchImpl?: typeof fetch;
  now?: Date;
  certDaysLeft?: (host: string) => Promise<number | null>;
};

type Health = { ok?: unknown; commit?: unknown; database?: unknown; jobs?: Record<string, { last_run?: unknown; ok?: unknown }> };

/** Days until the site's certificate expires, read from a real TLS handshake; null when it can't be read. */
export function certDaysLeft(host: string, now = new Date()): Promise<number | null> {
  return new Promise((resolve) => {
    const socket = connect({ host, port: 443, servername: host, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      const until = cert?.valid_to ? Date.parse(cert.valid_to) : NaN;
      resolve(Number.isFinite(until) ? Math.floor((until - now.getTime()) / 86_400_000) : null);
    });
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

export async function runChecks(base: string, opts: Options = {}): Promise<Check[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? new Date();
  const origin = new URL(base).origin;
  const get = async (path: string, init: RequestInit = {}) => {
    try {
      return await doFetch(`${origin}${path}`, { redirect: "manual", signal: AbortSignal.timeout(15_000), ...init });
    } catch {
      return null;
    }
  };
  const status = (r: Response | null) => (r ? `answered ${r.status}` : "didn't answer");
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string, fix?: string, sensitive = false) =>
    checks.push({ name, ok, detail, ...(ok || !fix ? {} : { fix }), ...(sensitive && !ok ? { sensitive: true as const } : {}) });

  const home = await get("/");
  const h = (name: string) => home?.headers.get(name) ?? "";
  const guarded = h("x-frame-options") === "DENY" && h("content-security-policy").includes("frame-ancestors 'none'") && h("x-content-type-options") === "nosniff" && h("strict-transport-security") !== "";
  add(
    "Home page, with its protections",
    home?.status === 200 && guarded,
    home?.status !== 200 ? status(home) : guarded ? "200, framing refused, HTTPS enforced" : "200, but a protective header is missing",
    home?.status !== 200 ? "Open Vercel → prism → Deployments: the latest production deploy may have failed; promote the last good one." : "Check next.config.ts headers() in the latest release.",
    home?.status === 200,
  );

  for (const path of ["/privacy", "/terms", "/sign-in", "/year", "/taxes", "/pricing"]) {
    const r = await get(path);
    add(`Page ${path}`, r?.status === 200, r?.status === 200 ? "200" : status(r), "Open the page; Vercel → prism → Logs shows the error for that path.");
  }

  const manifest = await get("/manifest.webmanifest");
  let named = false;
  try {
    named = manifest?.status === 200 && typeof ((await manifest.json()) as { name?: unknown }).name === "string";
  } catch {
    named = false;
  }
  const sw = await get("/sw.js");
  const swSafe = sw?.status === 200 && (sw.headers.get("cache-control") ?? "").includes("no-store") && (sw.headers.get("content-security-policy") ?? "").includes("default-src 'self'");
  add("Installable app", named && swSafe, named && swSafe ? "manifest and notification worker served, never cached" : `manifest ${status(manifest)}, worker ${status(sw)}`, "Check src/app/manifest.ts, public/sw.js and its headers in next.config.ts.");

  const cron = await get("/api/cron/alerts");
  add(
    "Alert job locked to its secret",
    cron?.status === 401,
    cron?.status === 401 ? "refuses a caller without the secret" : status(cron),
    cron?.status === 404
      ? "The job isn't configured: CRON_SECRET or RESEND_API_KEY is missing in Vercel's Production settings (README, Alert emails)."
      : "A job route that doesn't refuse a stranger is serious: roll back the latest deploy in Vercel, then look at src/app/api/cron/alerts.",
    cron !== null && cron.status !== 404,
  );

  // Prism Plus: off (404) until the owner adds Stripe's keys; on, an event without Stripe's signature is refused (401).
  const stripe = await get("/api/stripe/webhook", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  add(
    "Payments webhook locked to its signature",
    stripe?.status === 401 || stripe?.status === 404,
    stripe?.status === 401 ? "refuses an event Stripe didn't sign" : stripe?.status === 404 ? "billing is off" : status(stripe),
    "A payments webhook that doesn't refuse an unsigned event is serious: roll back the latest deploy in Vercel, then look at src/app/api/stripe/webhook.",
    stripe !== null && stripe.status !== 401 && stripe.status !== 404,
  );

  const exportZip = await get("/account/export/everything.zip");
  const toSignIn = exportZip?.status === 303 && new URL(exportZip.headers.get("location") ?? "/", origin).pathname === "/sign-in";
  add("Downloads need sign-in", toSignIn, toSignIn ? "a stranger is sent to sign in" : status(exportZip), "A download that doesn't send a stranger to sign in is serious: roll back the latest deploy in Vercel.", exportZip !== null);

  const discovery = await get("/.well-known/oauth-protected-resource/mcp");
  const mcp = await get("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const mcpOk = discovery?.status === 200 && mcp?.status === 401 && (mcp.headers.get("www-authenticate") ?? "").startsWith("Bearer");
  add(
    "AI connector asks for sign-in",
    mcpOk,
    mcpOk ? "discovery served, a call without a token refused" : `discovery ${status(discovery)}, call ${status(mcp)}`,
    "Check src/app/mcp and Supabase → Authentication → OAuth Server.",
    mcp !== null && mcp.status !== 401,
  );

  const res = await get("/api/health");
  let health: Health | null = null;
  try {
    health = res ? ((await res.json()) as Health) : null;
  } catch {
    health = null;
  }
  const dbOk = res?.status === 200 && health?.ok === true && health.database === "ok";
  add("Database answers", dbOk, dbOk ? "ok" : health?.database ? `database ${String(health.database)}` : status(res), "Open the Supabase project: it may be paused, over a limit or down (status.supabase.com).");

  if (opts.commit) {
    const want = opts.commit.slice(0, 7);
    add("Live release is the one just deployed", health?.commit === want, `live ${String(health?.commit ?? "unknown")}, deployed ${want}`, "The domain may still point at an older deploy: Vercel → prism → Domains.");
  }

  const job = health?.jobs?.alerts;
  if (!job) {
    add("Alert job ran", true, "hasn't run yet");
  } else {
    const at = typeof job.last_run === "string" ? Date.parse(job.last_run) : NaN;
    const hours = Number.isFinite(at) ? (now.getTime() - at) / 3_600_000 : Infinity;
    const fresh = hours <= JOB_STALE_HOURS;
    add(
      "Alert job ran",
      fresh && job.ok === true,
      !Number.isFinite(hours) ? "no time recorded" : `last ran ${Math.round(hours)} hours ago${job.ok === true ? "" : ", and didn't finish"}`,
      !fresh
        ? "Vercel → prism → Logs, filtered to /api/cron/alerts: no run means the cron isn't firing (vercel.json, Settings → Cron Jobs); a 500 means CRON_SECRET and the fingerprint in job_keys no longer match (README, Alert emails)."
        : "The run stopped: Resend refused its key. Make a new RESEND_API_KEY (README, Alert emails) and redeploy.",
    );
  }

  const host = new URL(origin).hostname;
  const days = await (opts.certDaysLeft ?? certDaysLeft)(host);
  add("Certificate", days !== null && days >= CERT_MIN_DAYS, days === null ? "couldn't be read" : `${days} days left`, "Vercel renews it on its own; if it isn't, check Vercel → prism → Domains for a DNS problem.");

  return checks;
}

/** In public, a failing protective check says only that one failed, and what to do first. */
function redacted(c: Check): Check {
  return c.sensitive
    ? {
        name: "A protective check",
        ok: false,
        detail: "withheld: this repository is public",
        fix: "Roll back the latest deploy in Vercel (Deployments → the one before → Promote), then run the check privately to see which door and why: node src/lib/ops/production-check.ts",
      }
    : c;
}

/** The checks as an issue body or a run summary; `publicly` withholds what a failing protective check found. */
export function report(all: Check[], meta: { base: string; commit?: string | null; at: Date; publicly?: boolean }): string {
  const checks = meta.publicly ? all.map(redacted) : all;
  const failing = checks.filter((c) => !c.ok);
  const lines = [
    failing.length ? `## Production check: ${failing.length} of ${checks.length} failing` : `## Production check: all ${checks.length} passing`,
    "",
    `${meta.base}${meta.commit ? ` · release ${meta.commit.slice(0, 7)}` : ""} · ${meta.at.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    "| | Check | What it found |",
    "|---|---|---|",
    ...checks.map((c) => `| ${c.ok ? "✅ Pass" : "❌ Fail"} | ${c.name} | ${c.detail.replace(/\|/g, "/")} |`),
  ];
  if (failing.some((c) => c.fix)) {
    lines.push("", "### What to do", "");
    for (const c of failing) if (c.fix) lines.push(`- **${c.name}:** ${c.fix}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main(argv: string[]) {
  const arg = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  const base = arg("base") ?? "https://prism.bis-rgv.com";
  const raw = arg("commit");
  const commit = raw && /^[0-9a-f]{7,40}$/.test(raw) ? raw : null;
  // Just after a deploy, the domain can take a minute to move to it: wait up to five for /api/health to name it.
  if (commit) {
    for (let i = 0; i < 20; i++) {
      try {
        const h = (await (await fetch(`${new URL(base).origin}/api/health`, { signal: AbortSignal.timeout(15_000) })).json()) as Health;
        if (h.commit === commit.slice(0, 7)) break;
      } catch {
        // Not up yet.
      }
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
  const checks = await runChecks(base, { commit });
  const text = report(checks, { base, commit, at: new Date(), publicly: argv.includes("--public") });
  console.log(text);
  const out = arg("report");
  if (out) writeFileSync(out, text);
  const summary = arg("summary");
  if (summary) appendFileSync(summary, text);
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main(process.argv.slice(2));
