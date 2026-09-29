// src/lib/supabase/server.ts
//
// A Supabase client for THIS request, acting as the signed-in person — never
// a privileged key. Row-level security in the database decides what it can
// see, so a bug here can at worst show someone their own data.

import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTH_COOKIE, supabaseEnv } from "./config";

export async function supabaseServer(): Promise<SupabaseClient | null> {
  const env = supabaseEnv();
  if (!env) return null;
  const jar = await cookies();
  return createServerClient(env.url, env.key, {
    cookieOptions: { name: AUTH_COOKIE },
    cookies: {
      getAll: () => jar.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) jar.set(name, value, options);
        } catch {
          // A Server Component can't set cookies. The proxy refreshes the
          // session before every page render, so nothing is lost here.
        }
      },
    },
  });
}

export type Account = { supabase: SupabaseClient; userId: string; email: string | null };

/**
 * The signed-in person, verified — getClaims() checks the token's signature
 * rather than trusting the cookie (never use getSession() on the server).
 * Cached per request, so the layout, the page and an action share one check.
 *
 * A token issued to a connected app (it carries `client_id`) is NOT a Prism
 * session, even though its signature is genuine: dressed up as this cookie it
 * would otherwise reach actions whose first step happens outside the database
 * — unlinking a bank at Plaid, revoking or refreshing Coinbase — before row-
 * level security could refuse anything. Connected apps get /mcp, and only that.
 *
 * Someone halfway through two-step sign-in (email code entered, authenticator
 * code not yet) isn't signed in either: see `awaitingSecondStep`.
 */
export const currentAccount = cache(async (): Promise<Account | null> => {
  const session = await signedInSession();
  return session && !session.secondStepPending ? session.account : null;
});

/**
 * Someone who has entered their email code but not yet the code from their
 * authenticator app, which is all /sign-in/two-step needs to finish the job.
 */
export const awaitingSecondStep = cache(async (): Promise<Account | null> => {
  const session = await signedInSession();
  return session?.secondStepPending ? session.account : null;
});

/**
 * Every genuine Prism session, finished or not. The database decides whether
 * the second step is still owed (`second_step_pending`, the same check row-
 * level security makes). If it can't answer, the answer is "owed": the two-step
 * page asks again, rather than an account that can't read its own rows
 * passing for an empty one.
 */
const signedInSession = cache(async (): Promise<{ account: Account; secondStepPending: boolean } | null> => {
  const supabase = await supabaseServer();
  if (!supabase) return null;
  const jar = await cookies();
  if (!jar.getAll().some((c) => c.name === AUTH_COOKIE || c.name.startsWith(`${AUTH_COOKIE}.`))) return null;
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub || claims.client_id !== undefined) return null;
  const account = { supabase, userId: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
  return { account, secondStepPending: await secondStepPending(supabase) };
});

/** Whether this session still owes the authenticator code. Unsure counts as yes. */
export async function secondStepPending(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("second_step_pending");
  return error ? true : data === true;
}

/** Where to finish signing in, carrying on to `next` afterwards. */
export function twoStepPath(next: string | null): string {
  return next ? `/sign-in/two-step?next=${encodeURIComponent(next)}` : "/sign-in/two-step";
}
