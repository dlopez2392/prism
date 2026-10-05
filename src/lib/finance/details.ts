// src/lib/finance/details.ts
//
// What a person adds to one of their own transactions:
//   - a SPLIT across categories (the warehouse run that was groceries AND a
//     lamp), so every chart, budget and total counts each part where it
//     belongs;
//   - TAGS of their own ("Vacation 2026", "Work trip"), to find and total a
//     trip or a project across categories;
//   - who OWES them for it, and how much, until they mark it paid back;
//   - that it's LEFT OUT of their totals: a one-off that would skew them (a
//     car, a work trip paid back), still listed but counted in no spending,
//     income or budget. A whole ACCOUNT can be left out the same way (a
//     business card, a closed account): its balance leaves net worth and
//     every line in it is left out (hideAccounts).
// Kept sealed in their account by transaction id (server/details-actions.ts)
// and applied to their own view only, after their category fixes.
//
// A split becomes its parts: one line per part, each with its own category
// and amount and the id `<id>~<n>`, so the analysis needs no special case.
// What looks for things that repeat (recurring.ts) sees the whole line
// again (wholeLines), so a split bill still forecasts as one bill. A split
// whose parts no longer add up to the bank's amount (a tip added when the
// charge posted) is set aside, never stretched to fit: the line shows whole
// until the person splits it again.
//
// A split can also follow a SHOP: every purchase at Costco, say, 70% food
// and 30% household. It's kept as shares (hundredths of a percent) under the
// shop's name as recurring.ts groups it, and splits each purchase there that
// the person hasn't split, or kept whole, themselves; the cents left over by
// rounding go to the parts that lost the most, so the parts always add up.

import { CATEGORIES, isSpendCategory } from "./categories";
import { money, shortDate } from "./format";
import { normalizeMerchant } from "./merchant";
import { cleanText } from "./p2p";
import type { Account, Cents, FinanceData, Holding, ISODate, Owed, SpendCategoryId, Transaction } from "./types";

export type { Owed };
export type SplitPart = { category: SpendCategoryId; amount: Cents };
/** What the person added to one transaction. Split amounts are positive: their sign is the transaction's. `whole`: not split, even by a shop's rule. `out`: left out of every total. */
export type TxnDetail = { split?: SplitPart[]; tags?: string[]; owed?: Owed; whole?: true; out?: true };
/** One part of a shop's split, in hundredths of a percent: 7000 is 70%. */
export type SplitShare = { category: SpendCategoryId; share: number };
/** Every purchase at one shop, split the same way. `name` is how the bank last wrote it. */
export type SplitRule = { name: string; split: SplitShare[] };
/** `rules` is keyed by the shop as normalizeMerchant writes it. `hidden`: the ids of accounts left out of every total. */
export type TxnDetails = { v: 1; lines: Record<string, TxnDetail>; rules?: Record<string, SplitRule>; hidden?: string[] };

export const NO_DETAILS: TxnDetails = { v: 1, lines: {} };

export const DETAIL_LIMITS = {
  /** Transactions with details, at most. */
  lines: 5000,
  parts: 8,
  tags: 6,
  tagLength: 30,
  whoLength: 40,
  /** Tags a person can have across everything, so the list stays one they can scan. */
  allTags: 60,
  /** Shops with a split of their own. */
  rules: 100,
  ruleName: 60,
  /** Accounts left out of totals. */
  hidden: 200,
} as const;

/** The longest account id kept: Plaid's are 37 characters; a household's or a wallet's a little longer. */
const ACCOUNT_ID_MAX = 200;

/** All of a purchase, in shares. */
export const WHOLE_SHARE = 10_000;
const RULE_KEY_MAX = 120;

const TXN_ID_MAX = 200;
const SPLIT_MARK = "~";

/** A tag as it's kept: words, no control or direction characters, one space between words. */
export function cleanTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = cleanText(raw, DETAIL_LIMITS.tagLength);
  return t ? t : null;
}

function validParts(x: unknown): SplitPart[] | null {
  if (!Array.isArray(x) || x.length < 2 || x.length > DETAIL_LIMITS.parts) return null;
  const parts: SplitPart[] = [];
  for (const p of x) {
    if (!p || typeof p !== "object") return null;
    const { category, amount } = p as Record<string, unknown>;
    if (typeof category !== "string" || !Object.hasOwn(CATEGORIES, category) || !isSpendCategory(category as SpendCategoryId)) return null;
    if (!Number.isSafeInteger(amount) || (amount as number) <= 0) return null;
    parts.push({ category: category as SpendCategoryId, amount: amount as number });
  }
  return parts;
}

function validTags(x: unknown): string[] | null {
  if (!Array.isArray(x)) return null;
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of x) {
    const t = cleanTag(raw);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    tags.push(t);
    if (tags.length === DETAIL_LIMITS.tags) break;
  }
  return tags.length ? tags : null;
}

function validOwed(x: unknown): Owed | null {
  if (!x || typeof x !== "object") return null;
  const { who, amount, paid } = x as Record<string, unknown>;
  const name = typeof who === "string" ? cleanText(who, DETAIL_LIMITS.whoLength) : "";
  if (!name || !Number.isSafeInteger(amount) || (amount as number) <= 0) return null;
  if (paid !== null && (typeof paid !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(paid))) return null;
  return { who: name, amount: amount as number, paid: paid as ISODate | null };
}

/** One transaction's details, as stored: only what's valid on its own, or null when nothing is. */
export function validDetail(x: unknown): TxnDetail | null {
  if (!x || typeof x !== "object") return null;
  const d = x as Record<string, unknown>;
  const split = d.split === undefined ? null : validParts(d.split);
  const tags = d.tags === undefined ? null : validTags(d.tags);
  const owed = d.owed === undefined ? null : validOwed(d.owed);
  // Kept whole means nothing next to a split of its own.
  const whole = d.whole === true && !split;
  const out = d.out === true;
  if (!split && !tags && !owed && !whole && !out) return null;
  return {
    ...(split ? { split } : {}),
    ...(tags ? { tags } : {}),
    ...(owed ? { owed } : {}),
    ...(whole ? { whole: true as const } : {}),
    ...(out ? { out: true as const } : {}),
  };
}

/** A shop's split as stored: 2 to 8 spending categories whose shares make exactly the whole. */
export function validRule(x: unknown): SplitRule | null {
  if (!x || typeof x !== "object") return null;
  const { name, split } = x as Record<string, unknown>;
  const label = typeof name === "string" ? cleanText(name, DETAIL_LIMITS.ruleName) : "";
  if (!label || !Array.isArray(split) || split.length < 2 || split.length > DETAIL_LIMITS.parts) return null;
  const shares: SplitShare[] = [];
  for (const p of split) {
    const { category, share } = (p ?? {}) as Record<string, unknown>;
    if (typeof category !== "string" || !Object.hasOwn(CATEGORIES, category) || !isSpendCategory(category as SpendCategoryId)) return null;
    if (!Number.isSafeInteger(share) || (share as number) <= 0) return null;
    shares.push({ category: category as SpendCategoryId, share: share as number });
  }
  return shares.reduce((s, p) => s + p.share, 0) === WHOLE_SHARE ? { name: label, split: shares } : null;
}

/** A shop's name as a rule is kept under: the way recurring.ts groups it, or null when there's nothing to go by. */
export function ruleKey(merchant: string): string | null {
  const key = normalizeMerchant(merchant).slice(0, RULE_KEY_MAX);
  return key ? key : null;
}

/** Whole cents (or shares) in proportion to `weights`, adding up to exactly `total`: what rounding leaves goes to the largest remainders. */
function apportion(total: number, weights: number[], of: number): number[] {
  const exact = weights.map((w) => (total * w) / of);
  const out = exact.map(Math.floor);
  const order = exact.map((x, i) => [x - out[i]!, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0, left = total - out.reduce((s, x) => s + x, 0); k < left; k++) out[order[k]![1]]!++;
  return out;
}

/** A split as shares of the whole, for a shop's rule; null when a part is too small to keep a share of. */
export function sharesOf(parts: SplitPart[]): SplitShare[] | null {
  const total = parts.reduce((s, p) => s + p.amount, 0);
  const shares = apportion(WHOLE_SHARE, parts.map((p) => p.amount), total);
  return shares.every((x) => x > 0) ? parts.map((p, i) => ({ category: p.category, share: shares[i]! })) : null;
}

/** A purchase split by a shop's shares, to the cent; parts that round to nothing are left out. */
export function partsByShare(total: Cents, split: SplitShare[]): SplitPart[] {
  const amounts = apportion(total, split.map((p) => p.share), WHOLE_SHARE);
  return split.map((p, i) => ({ category: p.category, amount: amounts[i]! })).filter((p) => p.amount > 0);
}

/** Everything stored, as it was kept: anything unreadable is dropped, never guessed at. */
export function validDetails(x: unknown): TxnDetails {
  if (!x || typeof x !== "object" || (x as { v?: unknown }).v !== 1) return NO_DETAILS;
  const raw = (x as { lines?: unknown }).lines;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NO_DETAILS;
  const kept: [string, TxnDetail][] = [];
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || id.length > TXN_ID_MAX || id.includes(SPLIT_MARK)) continue;
    const d = validDetail(value);
    if (d) kept.push([id, d]);
    if (kept.length === DETAIL_LIMITS.lines) break;
  }
  const stored = (x as { rules?: unknown }).rules;
  const rules: [string, SplitRule][] = [];
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
      // Only a key a shop's name could have made, so a rule always finds its purchases.
      if (ruleKey(key) !== key) continue;
      const r = validRule(value);
      if (r) rules.push([key, r]);
      if (rules.length === DETAIL_LIMITS.rules) break;
    }
  }
  const listed = (x as { hidden?: unknown }).hidden;
  const hidden = Array.isArray(listed)
    ? [...new Set(listed.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= ACCOUNT_ID_MAX))].slice(0, DETAIL_LIMITS.hidden)
    : [];
  return { v: 1, lines: Object.fromEntries(kept), ...(rules.length ? { rules: Object.fromEntries(rules) } : {}), ...(hidden.length ? { hidden } : {}) };
}

/**
 * A change the person asked for, checked against the transaction it names
 * (their own, whole): a split must be money out, its parts must add up to
 * exactly what the bank says, and what's owed can't be more than was paid.
 * Null keeps nothing for that transaction (the person cleared it).
 */
export function checkDetail(t: Pick<Transaction, "amount" | "category">, x: unknown): { detail: TxnDetail | null } | { error: string } {
  if (!x || typeof x !== "object") return { error: "That didn't come through. Try again." };
  const d = x as Record<string, unknown>;
  const total = Math.abs(t.amount);
  let split: SplitPart[] | null = null;
  if (d.split !== undefined && d.split !== null) {
    if (t.amount >= 0 || t.category === "income") return { error: "Only money going out can be split." };
    split = validParts(d.split);
    if (!split) return { error: `Split it into 2 to ${DETAIL_LIMITS.parts} parts, each with a category and an amount.` };
    const sum = split.reduce((s, p) => s + p.amount, 0);
    if (sum !== total) return { error: `The parts add up to ${dollars(sum)}; they need to add up to ${dollars(total)}.` };
  }
  const tags = d.tags === undefined || d.tags === null ? null : validTags(d.tags);
  let owed: Owed | null = null;
  if (d.owed !== undefined && d.owed !== null) {
    owed = validOwed(d.owed);
    if (!owed) return { error: "Say who owes you, and how much." };
    if (t.amount >= 0) return { error: "Only money you paid out can be owed back." };
    if (owed.amount > total) return { error: `They can owe you at most ${dollars(total)}, what this cost.` };
  }
  if (!split && !tags && !owed) return { detail: null };
  return { detail: { ...(split ? { split } : {}), ...(tags ? { tags } : {}), ...(owed ? { owed } : {}) } };
}

const dollars = (c: Cents) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Anything to keep: a line's own details, a shop's split with no line of its own (a split rule made from a plain purchase), or an account left out. */
export function hasDetails(details: TxnDetails): boolean {
  return Object.keys(details.lines).length > 0 || Object.keys(details.rules ?? {}).length > 0 || (details.hidden?.length ?? 0) > 0;
}

/** The details with one transaction's set (or cleared, with null). */
export function withDetail(old: TxnDetails, id: string, detail: TxnDetail | null): TxnDetails {
  const lines = { ...old.lines };
  if (detail) lines[id] = detail;
  else delete lines[id];
  return validDetails({ ...old, lines });
}

/** The details with one shop's split set (or removed, with null). */
export function withRule(old: TxnDetails, key: string, rule: SplitRule | null): TxnDetails {
  const rules = { ...old.rules };
  if (rule) rules[key] = rule;
  else delete rules[key];
  return validDetails({ ...old, rules });
}

/** The details with one account left out of every total (or counted again). */
export function withHidden(old: TxnDetails, accountId: string, hidden: boolean): TxnDetails {
  const ids = (old.hidden ?? []).filter((id) => id !== accountId);
  return validDetails({ ...old, hidden: hidden ? [...ids, accountId] : ids });
}

/** Each transaction with what the person added: a split becomes its parts, and a line left out (or in an account left out) says so. Never changes the transactions it's given. */
export function applyDetails<T extends Transaction>(txns: T[], details: TxnDetails): T[] {
  if (!hasDetails(details)) return txns;
  const rules = details.rules ?? {};
  const hidden = new Set(details.hidden ?? []);
  const out: T[] = [];
  for (const t of txns) {
    const d = Object.hasOwn(details.lines, t.id) ? details.lines[t.id]! : null;
    // A shop's split, for a purchase there the person hasn't split or kept whole themselves.
    const key = !d?.split && !d?.whole && t.amount < 0 && isSpendCategory(t.category) ? ruleKey(t.merchant) : null;
    const rule = key !== null && Object.hasOwn(rules, key) ? rules[key]! : null;
    // Its account left out says more than the line: that's the one switch that would count it again.
    const leftOut = hidden.has(t.accountId) ? ("account" as const) : d?.out === true ? ("line" as const) : null;
    if (!d && !rule) {
      out.push(leftOut ? { ...t, excluded: leftOut } : t);
      continue;
    }
    const base: T = { ...t, ...(d?.tags ? { tags: d.tags } : {}), ...(d?.owed ? { owed: d.owed } : {}), ...(leftOut ? { excluded: leftOut } : {}) };
    const own = d?.split && t.amount < 0 && d.split.reduce((s, p) => s + p.amount, 0) === -t.amount ? d.split : null;
    const byRule = !own && rule ? partsByShare(-t.amount, rule.split) : null;
    const parts = own ?? (byRule && byRule.length >= 2 ? byRule : null);
    if (!parts) {
      out.push(base);
      continue;
    }
    // What the bank said, so a part the person moved says so, and a part that kept it keeps the bank's tax category.
    const bank = t.bankCategory ?? t.category;
    parts.forEach((p, i) => {
      const part: T = {
        ...base,
        id: `${t.id}${SPLIT_MARK}${i + 1}`,
        amount: -p.amount,
        category: p.category,
        split: { of: t.id, part: i + 1, parts: parts.length, total: t.amount, ...(own ? {} : { rule: true as const }) },
      };
      if (p.category === bank) delete part.bankCategory;
      else part.bankCategory = bank;
      // What's owed belongs to the whole line: counted once, on its first part.
      if (i > 0) delete part.owed;
      out.push(part);
    });
  }
  return out;
}

/** The lines as the bank sent them: a split's parts joined back into one, in the category of its largest part. */
export function wholeLines<T extends Transaction>(txns: T[]): T[] {
  if (!txns.some((t) => t.split)) return txns;
  const out: T[] = [];
  const wholes = new Map<string, { line: T; biggest: Cents; bank: Transaction["category"] }>();
  for (const t of txns) {
    if (!t.split) {
      out.push(t);
      continue;
    }
    const seen = wholes.get(t.split.of);
    if (!seen) {
      const line: T = { ...t, id: t.split.of, amount: t.split.total };
      delete line.split;
      wholes.set(t.split.of, { line, biggest: Math.abs(t.amount), bank: t.bankCategory ?? t.category });
      out.push(line);
    } else if (Math.abs(t.amount) > seen.biggest) {
      seen.biggest = Math.abs(t.amount);
      seen.line.category = t.category;
    }
  }
  for (const { line, bank } of wholes.values()) {
    if (line.category === bank) delete line.bankCategory;
    else line.bankCategory = bank;
  }
  return out;
}

/** A friendly nudge about what someone owes, for the person to send themselves. */
export function reminderText(o: { who: string; amount: Cents; merchant: string; date: ISODate }): string {
  return `Hi ${o.who}, a quick reminder about the ${money(o.amount)} for ${o.merchant} on ${shortDate(o.date)}. Thanks!`;
}

/** Who owes the person what, still open, oldest first: each with the line it's for. */
export function stillOwed(txns: Transaction[]): { t: Transaction; owed: Owed }[] {
  return txns
    .filter((t): t is Transaction & { owed: Owed } => t.owed !== undefined && t.owed.paid === null)
    .map((t) => ({ t, owed: t.owed }))
    .sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : 0));
}

/** Every tag with what was spent under it and how many lines carry it, the most spent first. */
export function tagTotals(txns: Transaction[]): { tag: string; spent: Cents; count: number }[] {
  const by = new Map<string, { tag: string; spent: Cents; lines: Set<string> }>();
  for (const t of txns) {
    for (const tag of t.tags ?? []) {
      const key = tag.toLowerCase();
      const row = by.get(key) ?? { tag, spent: 0, lines: new Set<string>() };
      row.spent -= t.amount;
      // A split line is one line, however many parts it has.
      row.lines.add(t.split?.of ?? t.id);
      by.set(key, row);
    }
  }
  return [...by.values()].map(({ tag, spent, lines }) => ({ tag, spent, count: lines.size })).sort((a, b) => b.spent - a.spent || a.tag.localeCompare(b.tag));
}

/**
 * The money with the accounts the person left out set aside: out of the
 * accounts every total adds up (so out of net worth, and never the account a
 * forecast follows), and their holdings with them. Applied after the plan, so
 * a goal that follows one of them still does. Their lines are left out by
 * applyDetails; `hiddenAccounts` lists them so they can be counted again.
 */
export function hideAccounts<T extends FinanceData>(data: T, details: TxnDetails | null): T & { hiddenAccounts: Account[]; hiddenHoldings: Holding[] } {
  const hidden = new Set(details?.hidden ?? []);
  if (!data.accounts.some((a) => hidden.has(a.id))) return { ...data, hiddenAccounts: [], hiddenHoldings: [] };
  return {
    ...data,
    accounts: data.accounts.filter((a) => !hidden.has(a.id)),
    holdings: data.holdings.filter((h) => !hidden.has(h.accountId)),
    hiddenAccounts: data.accounts.filter((a) => hidden.has(a.id)),
    hiddenHoldings: data.holdings.filter((h) => hidden.has(h.accountId)),
  };
}

/** Every account and holding again, those left out of the totals included: a download of the person's data is all of it. */
export function everyAccount<T extends FinanceData>(data: T): T {
  if (!data.hiddenAccounts?.length) return data;
  return { ...data, accounts: [...data.accounts, ...data.hiddenAccounts], holdings: [...data.holdings, ...(data.hiddenHoldings ?? [])], hiddenAccounts: [], hiddenHoldings: [] };
}
