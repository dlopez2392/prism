// src/lib/alerts/refresh.ts
//
// The morning check: before the alert email job decides what to tell someone,
// it reads their banks again, so the email speaks for today and not for their
// last visit. Only for someone who left "Check my banks each morning" on with
// their alert emails, and never with Coinbase linked (the database decides
// both: alerts_sources answers null otherwise).
//
// It draws their money exactly as a visit draws it (morningFinance in
// finance.ts), with three things held back: Plaid is asked for balances and
// new transactions only (no holdings, no card terms), wallets keep their last
// reading (nobody else is asked), and nothing is written but the bank's new
// sealed copy, over the version it read, and the alert snapshot.

import "server-only";
import { validWallets } from "@/lib/crypto/wallets";
import { alertSnapshot, type AlertSnapshot } from "@/lib/finance/alert-snapshot";
import { NO_RULES, validCategoryRules } from "@/lib/finance/category-rules";
import { NO_DETAILS, validDetails } from "@/lib/finance/details";
import { assembleImports } from "@/lib/finance/import";
import { validManualItems } from "@/lib/finance/manual";
import { analyze } from "@/lib/finance/model";
import { validBudgets, validGoals } from "@/lib/finance/plan";
import { EN, type T } from "@/lib/i18n/t";
import { plaidConfig } from "@/lib/plaid/client";
import { validState, type StoredSync } from "@/lib/plaid/sync";
import { bankAttention, SEALED_SYNC_MAX } from "@/lib/server/account-store";
import { morningFinance, type Money } from "@/lib/server/finance";
import { openJson, openPacked, sealPacked, type VaultItem, type VaultKey } from "@/lib/server/vault";
import type { JobDb } from "./job";
import { localDay } from "./plan";
import type { AlertsConfig } from "./send";

type BankRow = {
  item_id: string;
  sealed_token: string;
  institution_id: string | null;
  institution_name: string | null;
  linked_at: string;
  sealed_sync: string | null;
  sync_version: number | null;
  synced_at: string | null;
  changed_at: string | null;
  attention: string | null;
  disconnect_at: string | null;
};
type ImportRow = { import_id: string; part: number; sealed: string; created_at: string };
type Sources = {
  time_zone: string | null;
  plan_budgets: unknown;
  plan_goals: unknown;
  sealed_category_rules: string | null;
  sealed_manual_items: string | null;
  sealed_wallets: string | null;
  sealed_txn_details?: string | null;
  banks: BankRow[];
  imports: ImportRow[];
};

const rows = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

/**
 * This morning's snapshot of the person's own money, in the language of `t`,
 * kept for the job and returned; null when the database won't hand over their
 * sources (they turned the check off, or linked Coinbase) or nothing of theirs
 * is live. Throws when the database can't be asked, so the run counts it.
 */
export async function morningCheck(db: JobDb, config: AlertsConfig, key: VaultKey, userId: string, now = new Date(), t: T = EN): Promise<AlertSnapshot | null> {
  const { data, error } = await db.rpc("alerts_sources", { p_secret: config.secret, p_user_id: userId });
  if (error) throw new Error("The database didn't hand over this person's sources.");
  if (!data || typeof data !== "object") return null;
  const src = data as Partial<Sources>;

  const items: VaultItem[] = [];
  const stored = new Map<string, StoredSync>();
  for (const r of rows<BankRow>(src.banks)) {
    // Sealed under a key the ring doesn't hold: unusable, so unread, as on a visit.
    const opened = openJson(r.sealed_token, key) as { accessToken?: unknown } | null;
    if (typeof opened?.accessToken !== "string") continue;
    const attention = bankAttention(r);
    items.push({ itemId: r.item_id, accessToken: opened.accessToken, institutionId: r.institution_id, institutionName: r.institution_name, linkedAt: r.linked_at, ...(attention ? { attention } : {}) });
    const state = validState(r.sealed_sync ? openPacked(r.sealed_sync, key) : null);
    stored.set(r.item_id, { state, version: r.sync_version ?? 0, syncedAt: state ? r.synced_at : null, changedAt: r.changed_at ?? null });
  }

  const saves: Promise<unknown>[] = [];
  const parts = rows<ImportRow>(src.imports).map((r) => ({ importId: r.import_id, part: r.part, opened: openPacked(r.sealed, key), createdAt: r.created_at }));
  const rules = src.sealed_category_rules ? openPacked(src.sealed_category_rules, key) : null;
  const manual = src.sealed_manual_items ? openPacked(src.sealed_manual_items, key) : null;
  const wallets = src.sealed_wallets ? openPacked(src.sealed_wallets, key) : null;
  const details = src.sealed_txn_details ? openPacked(src.sealed_txn_details, key) : null;
  const money: Money = {
    items: plaidConfig() ? items : [],
    plaidSync: {
      stored,
      // Kept exactly as a visit keeps it: only over the version it was read from.
      save: (itemId, state, fromVersion, startedAt) => {
        const sealed = sealPacked(state, key);
        if (sealed.length > SEALED_SYNC_MAX) return;
        saves.push(Promise.resolve(db.rpc("alerts_save_sync", { p_secret: config.secret, p_user_id: userId, p_item_id: itemId, p_sealed_sync: sealed, p_from_version: fromVersion, p_synced_at: startedAt })));
      },
      // A bank's warning is the person's to clear, on their own visit.
      clear: null,
      minimal: true,
    },
    categories: rules === null ? NO_RULES : validCategoryRules(rules),
    manual: manual === null ? [] : validManualItems(manual),
    imports: assembleImports(parts).imports,
    wallets: { list: wallets === null ? [] : validWallets(wallets), save: null, scan: null, offline: true },
    coinbase: null,
    // A bill they split counts in its parts, as on a visit.
    details: details === null ? NO_DETAILS : validDetails(details),
  };

  const plan = { budgets: validBudgets(src.plan_budgets ?? undefined), goals: validGoals(src.plan_goals ?? undefined) };
  const finance = await morningFinance(money, plan, localDay(src.time_zone ?? null, now));
  await Promise.allSettled(saves);
  if (!finance) return null;

  // In the language their email goes in, so a bill or a price reads the same as the rest of it.
  const snapshot = alertSnapshot(analyze(finance, t), now.toISOString(), "morning", t);
  const kept = await db.rpc("alerts_save_snapshot", { p_secret: config.secret, p_user_id: userId, p_sealed: sealPacked(snapshot, key) });
  // Not kept, still used: this email is right either way, and the next visit or morning keeps one.
  if (kept.error) console.error("Prism: a morning check's snapshot wasn't kept.");
  return snapshot;
}
