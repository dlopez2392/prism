// src/lib/finance/manual.ts
//
// What a person owns or owes that no bank reports — their home, a car, a
// loan from family — added by hand so their net worth is the whole picture.
// Each item keeps one value per month, the latest the person entered, and
// that value carries forward until they update it; so the trend lines and
// "12 mo" changes on Net worth work for these exactly as for a bank account.
// A home whose value RentCast keeps up to date gets that month's value the
// same way, marked `estimated` (finance/home-value.ts); a value the person
// types for a month is theirs, and no estimate replaces it.
//
// Stored sealed in the person's account (profiles.sealed_manual_items) and
// read back as untrusted input: an invalid item is dropped, alone.

import { lastMonths } from "./dates";
import type { Account, AccountKind, Cents, ISODate, Institution } from "./types";

export type ManualKind = "home" | "vehicle" | "asset" | "debt";

export type ManualValue = {
  month: string;
  value: Cents;
  /** RentCast's estimate for the month, not the person's own figure. */
  estimated?: true;
};

export type ManualItem = {
  id: string;
  kind: ManualKind;
  name: string;
  /** Oldest first, one per month ("YYYY-MM"), amounts always positive: a debt's sign comes from its kind. */
  values: ManualValue[];
};

export const MANUAL_KINDS: Record<ManualKind, { label: string; accountKind: AccountKind; owed: boolean; placeholder: string }> = {
  home: { label: "A home", accountKind: "property", owed: false, placeholder: "Our house" },
  vehicle: { label: "A vehicle", accountKind: "property", owed: false, placeholder: "2019 Honda Civic" },
  asset: { label: "Something else you own", accountKind: "property", owed: false, placeholder: "Grandma's ring" },
  debt: { label: "Money you owe", accountKind: "loan", owed: true, placeholder: "Loan from Mom" },
};

export const MAX_MANUAL_ITEMS = 30;
export const MANUAL_NAME_MAX = 40;
/** $10 billion: nobody's house, and it keeps sums far inside safe integers. */
export const MANUAL_VALUE_MAX: Cents = 1_000_000_000_000;
/** Two years of monthly values: Net worth shows 13 months; the rest is room for later charts. */
const VALUES_KEPT = 24;
export const MANUAL_INSTITUTION_ID = "manual";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isManualKind(x: unknown): x is ManualKind {
  return typeof x === "string" && Object.hasOwn(MANUAL_KINDS, x);
}

/** A name as a person would type it: trimmed, spaces collapsed, no control characters. Null if nothing is left or it's too long. */
export function cleanManualName(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const s = x.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return s.length > 0 && s.length <= MANUAL_NAME_MAX ? s : null;
}

function validValues(x: unknown): ManualItem["values"] | null {
  if (!Array.isArray(x) || x.length === 0 || x.length > VALUES_KEPT) return null;
  const out: ManualItem["values"] = [];
  for (const v of x) {
    const e = v as { month?: unknown; value?: unknown };
    if (typeof e?.month !== "string" || !MONTH.test(e.month)) return null;
    if (!Number.isSafeInteger(e.value) || (e.value as number) < 0 || (e.value as number) > MANUAL_VALUE_MAX) return null;
    if (out.length && out.at(-1)!.month >= e.month) return null; // oldest first, one per month
    out.push({ month: e.month, value: e.value as number, ...((v as { estimated?: unknown }).estimated === true ? { estimated: true as const } : {}) });
  }
  return out;
}

/** What's stored, as items: each valid item survives on its own; never more than the cap, never two with one id. */
export function validManualItems(x: unknown): ManualItem[] {
  if (!Array.isArray(x)) return [];
  const out: ManualItem[] = [];
  const ids = new Set<string>();
  for (const raw of x) {
    if (out.length >= MAX_MANUAL_ITEMS) break;
    const r = raw as Partial<ManualItem> | null;
    const id = typeof r?.id === "string" && /^[a-z0-9-]{1,40}$/.test(r.id) ? r.id : null;
    const name = cleanManualName(r?.name);
    const values = validValues(r?.values);
    if (!id || ids.has(id) || !isManualKind(r?.kind) || !name || !values) continue;
    ids.add(id);
    out.push({ id, kind: r.kind, name, values });
  }
  return out;
}

/** The item with `value` as this month's, replacing an earlier entry for the same month, keeping two years. */
export function withValue(item: ManualItem, month: string, value: Cents, estimated = false): ManualItem {
  const values = item.values.filter((v) => v.month < month);
  values.push({ month, value, ...(estimated ? { estimated: true as const } : {}) });
  return { ...item, values: values.slice(-VALUES_KEPT) };
}

/** The item as one of Prism's accounts: month-end values carried forward, signed by kind, aligned to the right like a newly linked bank. */
export function manualAccount(item: ManualItem, today: ISODate, months = 13): Account {
  const kind = MANUAL_KINDS[item.kind];
  const sign = kind.owed ? -1 : 1;
  const history: Cents[] = [];
  let current: Cents | null = null;
  let i = 0;
  for (const month of lastMonths(today, months)) {
    while (i < item.values.length && item.values[i]!.month <= month) current = item.values[i++]!.value;
    if (current !== null) history.push(sign * current);
  }
  // Entered for a month still ahead of today's (a clock that moved back): the latest value is still the balance.
  if (history.length === 0) history.push(sign * item.values.at(-1)!.value);
  return { id: `manual-${item.id}`, institutionId: MANUAL_INSTITUTION_ID, name: item.name, mask: null, kind: kind.accountKind, balance: history.at(-1)!, history, source: "manual" };
}

export function manualInstitution(): Institution {
  return { id: MANUAL_INSTITUTION_ID, name: "Added by you", health: "healthy", lastSyncedAt: null, source: "manual" };
}

/** The item behind a Net worth row, by its account id. */
export function manualIdOf(accountId: string): string | null {
  return accountId.startsWith("manual-") ? accountId.slice("manual-".length) : null;
}

/** A short id for a new item: from its name, never one already taken. */
export function manualId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "item";
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}
