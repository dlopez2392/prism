// src/lib/server/home-values.ts
//
// Asking RentCast what a home is worth, only with the database's go-ahead
// (claim_home_value_lookup: the cap across everyone, three homes a person,
// each home once a month), and keeping the answer as that month's value,
// marked as RentCast's. Used when a person saves a home with no value typed,
// and on their visits, after the response, for homes due this month.

import "server-only";
import { monthKey } from "@/lib/finance/dates";
import { valuationDue, type HomeValuation } from "@/lib/finance/home-value";
import { withValue } from "@/lib/finance/manual";
import type { ISODate } from "@/lib/finance/types";
import { estimateHomeValue, HomeValueError, homeValuesEnabled, type HomeEstimate } from "@/lib/homevalue/rentcast";
import type { Account } from "@/lib/supabase/server";
import { loadAccountHomeValues, loadAccountManualItems, saveAccountManualItemsAndHomes } from "./account-store";
import type { VaultKey } from "./vault";

type Env = Record<string, string | undefined>;

/** Why there's no estimate: the database said no, or RentCast couldn't answer. */
export type NoEstimate = "already" | "person-limit" | "limit" | "refused" | "error" | HomeValueError["reason"];

const ANSWERS = new Set(["ok", "already", "person-limit", "limit", "refused"]);

/** The database's go-ahead for one lookup. It counts the request, so it's asked only right before one. */
async function claim(account: Account, homeKey: string): Promise<"ok" | NoEstimate> {
  const { data, error } = await account.supabase.rpc("claim_home_value_lookup", { p_home_key: homeKey });
  if (error || typeof data !== "string" || !ANSWERS.has(data)) return "error";
  return data as "ok" | NoEstimate;
}

/** Claim, then ask. A claim is spent even when RentCast can't answer: the cap counts requests, not answers. */
export async function lookUpHomeValue(
  account: Account,
  home: Pick<HomeValuation, "address" | "key">,
  env: Env = process.env,
  fetchImpl?: typeof fetch,
): Promise<{ ok: true; estimate: HomeEstimate } | { ok: false; why: NoEstimate }> {
  if (!homeValuesEnabled(env)) return { ok: false, why: "refused" };
  const go = await claim(account, home.key);
  if (go !== "ok") return { ok: false, why: go };
  try {
    return { ok: true, estimate: await estimateHomeValue(home.address, env, fetchImpl) };
  } catch (e) {
    return { ok: false, why: e instanceof HomeValueError ? e.reason : "unavailable" };
  }
}

/** What to tell the person when there's no estimate. */
export function noEstimateMessage(why: NoEstimate): string {
  switch (why) {
    case "already":
      return "RentCast already estimated it this month. The next estimate comes next month.";
    case "person-limit":
      return "Prism estimates up to three homes a month for you. Enter this one's value yourself for now.";
    case "limit":
      return "Prism's home estimates are used up for now. Enter a value yourself; RentCast takes over again next month.";
    case "refused":
      return "Finish signing in, including your authenticator, and try again.";
    case "not-found":
      return "RentCast couldn't find that address. Check it, or enter a value yourself.";
    default:
      return "RentCast didn't answer. Enter a value for now; Prism tries again next month.";
  }
}

/**
 * On a visit, after the response: each home due this month, one at a time,
 * each answer saved over a fresh read. A value the person typed meanwhile
 * stays theirs; a home removed or moved meanwhile gets nothing.
 */
export async function refreshDueHomeValues(account: Account, key: VaultKey, today: ISODate, env: Env = process.env, fetchImpl?: typeof fetch): Promise<number> {
  if (!homeValuesEnabled(env)) return 0;
  const month = monthKey(today);
  const [items, homes] = await Promise.all([loadAccountManualItems(account, key), loadAccountHomeValues(account, key)]);
  const due = homes.filter((h) => {
    const item = items.find((i) => i.id === h.itemId);
    return item !== undefined && valuationDue(item, h, month);
  });
  let saved = 0;
  for (const home of due) {
    const r = await lookUpHomeValue(account, home, env, fetchImpl);
    if (!r.ok) continue;
    const [nowItems, nowHomes] = await Promise.all([loadAccountManualItems(account, key), loadAccountHomeValues(account, key)]);
    const item = nowItems.find((i) => i.id === home.itemId && i.kind === "home");
    const still = nowHomes.find((h) => h.itemId === home.itemId && h.key === home.key);
    if (!item || !still) continue;
    const typed = item.values.some((v) => v.month === month && !v.estimated);
    await saveAccountManualItemsAndHomes(
      account,
      typed ? nowItems : nowItems.map((i) => (i === item ? withValue(i, month, r.estimate.value, true) : i)),
      nowHomes.map((h) => (h === still ? { ...h, estimate: { low: r.estimate.low, high: r.estimate.high, on: today } } : h)),
      key,
    );
    saved++;
  }
  return saved;
}
