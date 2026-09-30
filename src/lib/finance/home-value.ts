// src/lib/finance/home-value.ts
//
// A home whose value RentCast keeps up to date: where it is (what RentCast is
// sent), the random key its lookups are counted by (never its name or
// address), and the last estimate's range. Kept sealed on the person's own
// profile, apart from the items themselves (profiles.sealed_home_values), so
// an address never travels with what they share with a household. Read back
// as untrusted input: an invalid entry is dropped, alone.
//
// An estimate becomes the home's value for its month, marked as RentCast's
// (manual.ts). A value the person types for a month is theirs: no estimate
// replaces it, and the next estimate waits for the next month.

import type { ManualItem } from "./manual";
import type { Cents, ISODate } from "./types";

export type HomeValuation = {
  itemId: string;
  address: string;
  /** A random uuid: what the lookup limit counts this home by. */
  key: string;
  /** The last estimate's range and the day it was made. */
  estimate: { low: Cents; high: Cents; on: ISODate } | null;
};

export const ADDRESS_MAX = 160;
const MAX_HOMES = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const cents = (x: unknown): x is Cents => Number.isSafeInteger(x) && (x as number) > 0 && (x as number) <= 1_000_000_000_000;

/** An address as a person would type it: trimmed, spaces collapsed, no control characters, with a number and a word in it. */
export function cleanAddress(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const s = x.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s.length >= 8 && s.length <= ADDRESS_MAX && /\d/.test(s) && /[a-z]{2}/i.test(s) ? s : null;
}

/** What's stored, as valuations: each valid one survives on its own; never two for one home. */
export function validHomeValues(x: unknown): HomeValuation[] {
  const list = (x as { v?: unknown; homes?: unknown } | null)?.v === 1 ? (x as { homes?: unknown }).homes : null;
  if (!Array.isArray(list)) return [];
  const out: HomeValuation[] = [];
  const seen = new Set<string>();
  for (const raw of list.slice(0, MAX_HOMES)) {
    const r = raw as Partial<HomeValuation> | null;
    const address = cleanAddress(r?.address);
    const itemId = typeof r?.itemId === "string" && /^[a-z0-9-]{1,40}$/.test(r.itemId) ? r.itemId : null;
    const key = typeof r?.key === "string" && UUID.test(r.key) ? r.key : null;
    if (!address || !itemId || !key || seen.has(itemId)) continue;
    const e = r?.estimate as HomeValuation["estimate"] | undefined;
    const estimate = e && cents(e.low) && cents(e.high) && e.low <= e.high && typeof e.on === "string" && DATE.test(e.on) ? { low: e.low, high: e.high, on: e.on } : null;
    seen.add(itemId);
    out.push({ itemId, address, key, estimate });
  }
  return out;
}

/** What's stored: sealed by the caller. */
export function storedHomeValues(homes: HomeValuation[]) {
  return { v: 1 as const, homes };
}

/** A home that's due this month's estimate: RentCast keeps it, and nothing (the person's figure or an estimate) is this month's yet. */
export function valuationDue(item: ManualItem, valuation: HomeValuation | undefined, month: string): boolean {
  return item.kind === "home" && valuation !== undefined && !item.values.some((v) => v.month === month);
}
