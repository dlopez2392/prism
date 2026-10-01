// src/lib/deployment.ts
//
// Which kind of deployment this is. A Vercel preview runs code that hasn't
// been merged (a branch, a Dependabot update), so it never reaches
// production's data: no database, no vault key, whatever its settings say.
// It serves the demo household. The settings say the same (PRISM_VAULT_KEY is
// Production only in Vercel); this holds even if one is ticked by mistake.

import type { Env } from "@/lib/plaid/client";

export function isPreviewDeployment(env: Env = process.env): boolean {
  return env.VERCEL_ENV?.trim() === "preview";
}
