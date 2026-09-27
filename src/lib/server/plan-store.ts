// src/lib/server/plan-store.ts
//
// Where an edited plan lives until Prism has accounts: two cookies on this
// device, one for budgets and one for goals, so each fits the 4 KB cookie
// limit on its own and each can be reset alone. The value is versioned JSON
// in base64url ("1.<payload>"); a future account can import it once and the
// cookie can go.
//
// Not sealed: it is the person's own plan, not a credential, and it never
// grants access to anything. It IS untrusted input, so reading goes through
// the all-or-nothing validators in `finance/plan.ts`.

import "server-only";
import { validBudgets, validGoals, type GoalSettings, type Plan } from "@/lib/finance/plan";
import type { Budget } from "@/lib/finance/types";
import type { Env } from "@/lib/plaid/client";

export const BUDGETS_COOKIE = "prism-budgets";
export const GOALS_COOKIE = "prism-goals";
/** Browsers cap a cookie's lifetime at 400 days. */
const PLAN_MAX_AGE = 60 * 60 * 24 * 400;
/** Room under the 4,096-byte cookie limit for the name and attributes. */
export const PLAN_COOKIE_MAX = 3_800;

type Jar = { get(name: string): { value: string } | undefined };

export function encodePlanValue(value: Budget[] | GoalSettings[]): string {
  return `1.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

function decode(raw: string | undefined): unknown {
  if (!raw || !raw.startsWith("1.") || raw.length > PLAN_COOKIE_MAX) return undefined;
  try {
    return JSON.parse(Buffer.from(raw.slice(2), "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

export function readPlan(jar: Jar): Plan {
  return {
    budgets: validBudgets(decode(jar.get(BUDGETS_COOKIE)?.value)),
    goals: validGoals(decode(jar.get(GOALS_COOKIE)?.value)),
  };
}

export function planCookieOptions(env: Env = process.env) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: PLAN_MAX_AGE,
  };
}
