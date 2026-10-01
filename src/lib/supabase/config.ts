// src/lib/supabase/config.ts
//
// Accounts are OFF unless both public settings are present, and every screen
// behaves exactly as before (demo household, plans on the device) when they
// are. They are OFF on a Vercel preview too, which never reaches production's
// database (deployment.ts). No "server-only" import: proxy.ts reads this too.
//
//   NEXT_PUBLIC_SUPABASE_URL              — https://<ref>.supabase.co
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  — the publishable (anon) key; safe in a browser,
//                                           because row-level security is what guards data

import { isPreviewDeployment } from "@/lib/deployment";
import type { Env } from "@/lib/plaid/client";

export type SupabaseEnv = { url: string; key: string };

/** The session cookie's name. Long sessions are split into prism-auth.0, .1, … */
export const AUTH_COOKIE = "prism-auth";

export function supabaseEnv(env: Env = process.env): SupabaseEnv | null {
  if (isPreviewDeployment(env)) return null;
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if (!url || !key || !/^https?:\/\//.test(url)) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

/** True when this request carries any piece of a Prism session. */
export function hasSessionCookie(names: Iterable<string>): boolean {
  for (const n of names) if (n === AUTH_COOKIE || n.startsWith(`${AUTH_COOKIE}.`)) return true;
  return false;
}
