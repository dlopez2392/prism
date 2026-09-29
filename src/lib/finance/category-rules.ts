// src/lib/finance/category-rules.ts
//
// A person's own fixes to the categories their bank gives transactions. A
// fix is either for one transaction or for every transaction at a merchant,
// past and future ("everything at Trader Joe's is Food & dining"); a
// one-transaction fix beats a merchant fix. They are applied where the
// transactions are assembled (server/finance.ts), so every chart, budget,
// insight, forecast and connected-app answer sees the same corrected money.
//
// Stored as JSON in the person's account (profiles.category_rules) and read
// back as untrusted input: anything that isn't a valid fix is dropped, one
// entry at a time, rather than losing the rest.

import { CATEGORIES } from "./categories";
import type { CategoryId, Transaction } from "./types";

export type CategoryRules = {
  v: 1;
  /** By merchantKey(): every transaction at this merchant. */
  merchants: Record<string, CategoryId>;
  /** By transaction id: just this one. */
  transactions: Record<string, CategoryId>;
};

export const NO_RULES: CategoryRules = { v: 1, merchants: {}, transactions: {} };
export const MAX_MERCHANT_RULES = 500;
export const MAX_TRANSACTION_RULES = 1_000;
const KEY_MAX = 200;

/** A merchant as a rule sees it: case, spacing and stray punctuation at the ends don't make a different merchant. */
export function merchantKey(merchant: string): string {
  return merchant
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s.,*#-]+|[\s.,*#-]+$/g, "")
    .slice(0, KEY_MAX);
}

export function isCategoryId(x: unknown): x is CategoryId {
  return typeof x === "string" && Object.hasOwn(CATEGORIES, x);
}

/** Money going out is never income; everything else can be anything (a refund is money in, in its shop's category). */
export function allowedFor(category: CategoryId, amount: number): boolean {
  return !(category === "income" && amount < 0);
}

/** The categories a person can choose for a transaction, in the order the pickers show them. */
export function choicesFor(amount: number): CategoryId[] {
  const all: CategoryId[] = ["housing", "food", "transport", "shopping", "fun", "health", "travel", "bills", "other", "income", "transfer"];
  return all.filter((c) => allowedFor(c, amount));
}

function validMap(x: unknown, max: number): Record<string, CategoryId> {
  const out: Record<string, CategoryId> = {};
  if (!x || typeof x !== "object" || Array.isArray(x)) return out;
  let n = 0;
  for (const [key, value] of Object.entries(x as Record<string, unknown>)) {
    if (n >= max) break;
    if (key.length === 0 || key.length > KEY_MAX || !isCategoryId(value)) continue;
    out[key] = value;
    n++;
  }
  return out;
}

/** What's stored, as rules: only the fixes that are valid survive, and never more than the caps. */
export function validCategoryRules(x: unknown): CategoryRules {
  const r = x as Partial<CategoryRules> | null;
  if (!r || typeof r !== "object" || r.v !== 1) return NO_RULES;
  return { v: 1, merchants: validMap(r.merchants, MAX_MERCHANT_RULES), transactions: validMap(r.transactions, MAX_TRANSACTION_RULES) };
}

export function hasRules(rules: CategoryRules): boolean {
  return Object.keys(rules.merchants).length > 0 || Object.keys(rules.transactions).length > 0;
}

/** The category a person chose for this transaction, if any: their fix for it, else for its merchant. */
export function ruleFor(t: Pick<Transaction, "id" | "merchant" | "amount">, rules: CategoryRules): CategoryId | null {
  const chosen = rules.transactions[t.id] ?? rules.merchants[merchantKey(t.merchant)] ?? null;
  return chosen && allowedFor(chosen, t.amount) ? chosen : null;
}

/**
 * The transactions with the person's fixes applied. A changed transaction
 * keeps the bank's category as `bankCategory`, so the list can say so and the
 * person can go back to it. The same array comes back when nothing changes.
 */
export function recategorize(transactions: Transaction[], rules: CategoryRules): Transaction[] {
  const any = hasRules(rules);
  let changed = false;
  const out = transactions.map((t) => {
    const bank = t.bankCategory ?? t.category;
    const chosen = any ? ruleFor(t, rules) : null;
    if (chosen && chosen !== bank) {
      if (chosen === t.category && t.bankCategory === bank) return t;
      changed = true;
      return { ...t, category: chosen, bankCategory: bank };
    }
    if (!t.bankCategory) return t;
    // Fixed before, and not any more: back to what the bank said.
    changed = true;
    const back: Transaction = { ...t, category: bank };
    delete back.bankCategory;
    return back;
  });
  return changed ? out : transactions;
}

export type CategoryFix =
  | { kind: "set"; transactionId: string; merchant: string; category: CategoryId; everyAtMerchant: boolean }
  | { kind: "reset"; transactionId: string; merchant: string };

/**
 * The rules after one fix. "Every purchase at" sets the merchant's rule and
 * drops this transaction's own, so the merchant rule governs it; "just this
 * one" sets only the transaction's. Reset goes back to the bank's category
 * for this transaction AND its merchant. Past the caps, the oldest fixes go.
 */
export function withFix(rules: CategoryRules, fix: CategoryFix): CategoryRules {
  const merchants = { ...rules.merchants };
  const transactions = { ...rules.transactions };
  const key = merchantKey(fix.merchant);
  delete transactions[fix.transactionId];
  if (fix.kind === "reset") {
    if (key) delete merchants[key];
  } else if (fix.everyAtMerchant && key) {
    delete merchants[key];
    merchants[key] = fix.category;
  } else {
    transactions[fix.transactionId] = fix.category;
  }
  return { v: 1, merchants: capped(merchants, MAX_MERCHANT_RULES), transactions: capped(transactions, MAX_TRANSACTION_RULES) };
}

/** Keeps the newest `max`: object keys keep their insertion order, and every fix is (re)inserted last. */
function capped(map: Record<string, CategoryId>, max: number): Record<string, CategoryId> {
  const entries = Object.entries(map);
  return entries.length <= max ? map : Object.fromEntries(entries.slice(entries.length - max));
}
