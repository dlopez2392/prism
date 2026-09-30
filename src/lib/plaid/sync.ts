// src/lib/plaid/sync.ts
//
// Bank sync that remembers where it left off. Plaid's /transactions/sync
// hands back a cursor with every page; keep it, and the next call returns
// only what was added, changed or removed since — instead of the whole
// history on every page view. The cursor lives in the client, so replaying
// from a saved one is always safe: a read-only caller (a connected app) can
// catch up in memory without saving anything.
//
// Pure apart from the Plaid calls, which take an injectable fetch.

import { plaidRequest, PlaidError, type PlaidAccount, type PlaidConfig, type PlaidTransaction } from "./client";
import { validLiabilities, type StoredLiabilities } from "./liabilities";

/** What is kept per linked bank, sealed: Plaid's cursor, every transaction synced so far, and the balances at that sync. */
export type SyncState = {
  v: 1;
  cursor: string;
  transactions: PlaidTransaction[];
  /** Plaid has finished its first pull; until then, keep asking. */
  ready: boolean;
  /** The accounts and balances as of this sync — so a fresh copy needs no Plaid call at all, and an outage still has a picture to show. */
  accounts?: PlaidAccount[] | null;
  /** Its cards' and loans' terms, read at most daily and only when switched on (liabilities.ts). */
  liabilities?: StoredLiabilities | null;
};

type SyncPage = {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string }[];
  next_cursor: string;
  has_more: boolean;
  transactions_update_status?: string;
};

const PAGE_SIZE = 500;
/** 100,000 transactions. A pass that still has more after this fails, rather than keeping half a history. */
const MAX_PAGES = 200;
const MAX_RESTARTS = 3;
/** Plaid serves up to 24 months; anything older than this is dropped so a copy can't grow forever. */
export const KEEP_DAYS = 760;
/** With no word from Plaid, a copy older than this is refreshed anyway — webhooks can be missed. */
export const FRESH_MS = 15 * 60_000;

/** Only the fields Prism reads, so a stored copy carries nothing it doesn't need. */
function slim(t: PlaidTransaction): PlaidTransaction {
  return {
    transaction_id: t.transaction_id,
    account_id: t.account_id,
    amount: t.amount,
    date: t.date,
    name: t.name,
    merchant_name: t.merchant_name ?? null,
    pending: t.pending,
    personal_finance_category: t.personal_finance_category ? { primary: t.personal_finance_category.primary, detailed: t.personal_finance_category.detailed } : null,
  };
}

/** Apply one page of changes, in Plaid's order: additions and edits land, removals go (a posted charge replaces its pending one this way). */
export function applyPage(byId: Map<string, PlaidTransaction>, page: Pick<SyncPage, "added" | "modified" | "removed">): void {
  for (const t of page.added) byId.set(t.transaction_id, slim(t));
  for (const t of page.modified) byId.set(t.transaction_id, slim(t));
  for (const r of page.removed) byId.delete(r.transaction_id);
}

export function pruneBefore(transactions: PlaidTransaction[], oldest: string): PlaidTransaction[] {
  return transactions.filter((t) => t.date >= oldest);
}

/**
 * Everything new since `from` (or the whole history when there's no copy
 * yet), as the next state to keep. If the bank's data moves while pages are
 * being read, Plaid says so and the whole pass restarts from the cursor it
 * began with — never from a page in the middle.
 */
/**
 * Plaid refusing the REQUEST (a 400 that isn't about the bank, the keys, the
 * rate or data moving mid-read) most likely means the saved cursor is no good
 * any more — Plaid only promises a cursor for a year. Starting over from no
 * cursor is the cure; keeping the old copy would pin the bank to it forever.
 */
function cursorRefused(e: unknown): boolean {
  if (!(e instanceof PlaidError) || e.status !== 400) return false;
  const notTheCursor = ["TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", "INVALID_ACCESS_TOKEN", "INVALID_API_KEYS", "SYNC_INCOMPLETE"];
  return !notTheCursor.includes(e.code) && !/^(ITEM_|INSTITUTION_|RATE_LIMIT|PRODUCT_|PENDING_)/.test(e.code);
}

export async function syncTransactions(
  config: PlaidConfig,
  accessToken: string,
  from: SyncState | null,
  opts: { today: string; fetchImpl?: typeof fetch } = { today: new Date().toISOString().slice(0, 10) },
): Promise<SyncState> {
  try {
    return await syncFrom(config, accessToken, from, opts);
  } catch (e) {
    if (from && cursorRefused(e)) return syncFrom(config, accessToken, null, opts);
    throw e;
  }
}

async function syncFrom(config: PlaidConfig, accessToken: string, from: SyncState | null, opts: { today: string; fetchImpl?: typeof fetch }): Promise<SyncState> {
  const start = from?.cursor ?? "";
  for (let attempt = 0; ; attempt++) {
    const byId = new Map((from?.transactions ?? []).map((t) => [t.transaction_id, t]));
    let cursor = start;
    let status: string | undefined;
    let more = true;
    try {
      for (let page = 0; page < MAX_PAGES && more; page++) {
        const res = await plaidRequest<SyncPage>(config, "/transactions/sync", { access_token: accessToken, cursor: cursor || undefined, count: PAGE_SIZE }, opts.fetchImpl);
        applyPage(byId, res);
        status = res.transactions_update_status ?? status;
        cursor = res.next_cursor;
        more = res.has_more;
      }
    } catch (e) {
      if (e instanceof PlaidError && e.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempt < MAX_RESTARTS) continue;
      throw e;
    }
    if (more) throw new PlaidError(0, "SYNC_INCOMPLETE", null, `Plaid still had more after ${MAX_PAGES} pages`);
    const oldest = new Date(Date.parse(`${opts.today}T00:00:00Z`) - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    return {
      v: 1,
      cursor,
      transactions: pruneBefore([...byId.values()], oldest),
      // Once ready, a later page that omits the status doesn't make it unready.
      ready: status ? status !== "NOT_READY" : (from?.ready ?? true),
      accounts: from?.accounts ?? null,
    };
  }
}

/** A stored copy, and what's known about it. */
export type StoredSync = { state: SyncState | null; version: number; syncedAt: string | null; changedAt: string | null };

/** Ask Plaid again? When there's no copy, Plaid isn't done, Plaid said there's news since, or the copy has aged. */
export function needsSync(stored: StoredSync | null | undefined, now = Date.now()): boolean {
  if (!stored?.state || !stored.syncedAt || !stored.state.ready) return true;
  const synced = Date.parse(stored.syncedAt);
  if (!Number.isFinite(synced)) return true;
  if (stored.changedAt && Date.parse(stored.changedAt) > synced) return true;
  return now - synced > FRESH_MS;
}

/** A stored copy that isn't one — foreign, old-format, or malformed — reads as none, and the next sync starts over. */
export function validState(x: unknown): SyncState | null {
  const s = x as Partial<SyncState> | null;
  if (!s || s.v !== 1 || typeof s.cursor !== "string" || !Array.isArray(s.transactions) || typeof s.ready !== "boolean") return null;
  if (s.accounts != null && (!Array.isArray(s.accounts) || !s.accounts.every((a) => a && typeof a.account_id === "string" && a.balances && typeof a.type === "string"))) return null;
  const ok = s.transactions.every(
    (t) => t && typeof t.transaction_id === "string" && typeof t.account_id === "string" && typeof t.amount === "number" && typeof t.date === "string" && typeof t.pending === "boolean",
  );
  // Terms that don't check out are dropped and read again; they never cost the bank its copy.
  if (!ok) return null;
  return (s.liabilities === undefined ? s : { ...s, liabilities: validLiabilities(s.liabilities) }) as SyncState;
}
