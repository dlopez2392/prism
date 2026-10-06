"use server";

// src/lib/server/import-actions.ts
//
// The Server Actions behind "Import history" (/connections/import). The file
// itself never reaches the server: the page reads it in the browser and sends
// only the rows it mapped, a batch at a time. Nothing from the browser is
// trusted: every row and the import's description are checked again here,
// then sealed with the vault key before they're stored (imported_history).
//
// An import is stored as numbered parts. The page sends parts 1… first and
// part 0, which says what the import is and how many parts it has, LAST: an
// import is only ever shown once every part it counts is there, so a closed
// tab leaves nothing half-imported on screen (and account-store removes the
// leftovers a day later). Next checks each action's Origin against the host.

import { refresh } from "next/cache";
import { IMPORT_LIMITS, validImportMeta, validImportRow, type ImportRow, type StoredPart } from "@/lib/finance/import";
import { getT } from "@/lib/i18n/server";
import { msg, type T } from "@/lib/i18n/t";
import { currentAccount, type Account } from "@/lib/supabase/server";
import { requestToday } from "./finance";
import { sealPacked, vaultKey, type VaultKey } from "./vault";

export type ImportResult = { ok: true } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TRY_AGAIN = msg("That didn't save. Try the import again in a minute.");
const START_AGAIN = msg("Something in that import didn't check out. Start it again.");
const ROWS_START_AGAIN = msg("Some rows in that file didn't check out. Start the import again.");

async function owner(t: T): Promise<{ account: Account; key: VaultKey } | ImportResult> {
  const account = await currentAccount();
  if (!account) return { ok: false, message: t("Sign in to import history. It's kept in your account.") };
  let key: VaultKey | null = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  if (!key) return { ok: false, message: t("Prism can't save imports right now. Try again later.") };
  return { account, key };
}

/** A batch of rows, every one of them checked; null when any isn't a transaction Prism would keep. */
function checkedRows(rows: unknown, today: string, allowEmpty: boolean): ImportRow[] | null {
  if (!Array.isArray(rows) || rows.length > IMPORT_LIMITS.batch || (!allowEmpty && rows.length === 0)) return null;
  return rows.every((r) => validImportRow(r, today)) ? (rows as ImportRow[]).map(({ date, amount, merchant, category }) => ({ date, amount, merchant, category })) : null;
}

async function store(account: Account, key: VaultKey, importId: string, part: number, value: StoredPart, t: T): Promise<ImportResult> {
  const { error } = await account.supabase
    .from("imported_history")
    .insert({ user_id: account.userId, import_id: importId, part, sealed: sealPacked(value, key) });
  if (!error) return { ok: true };
  // The database's own limit, in its own words.
  if (error.code === "23514") return { ok: false, message: t("Prism keeps up to twenty imports. Remove one on Connections first.") };
  return { ok: false, message: t(TRY_AGAIN) };
}

/** One batch of an import, after the first: part 1 and on. */
export async function saveImportPart(importId: unknown, part: unknown, rows: unknown): Promise<ImportResult> {
  const t = await getT();
  const who = await owner(t);
  if ("ok" in who) return who;
  if (typeof importId !== "string" || !UUID.test(importId) || !Number.isInteger(part) || (part as number) < 1 || (part as number) >= IMPORT_LIMITS.parts) {
    return { ok: false, message: t(START_AGAIN) };
  }
  const checked = checkedRows(rows, await requestToday(), false);
  if (!checked) return { ok: false, message: t(ROWS_START_AGAIN) };
  return store(who.account, who.key, importId, part as number, { v: 1, rows: checked }, t);
}

/** The import's last write: what it is, how many parts it has, and its first batch. Only now does it show. */
export async function finishImport(importId: unknown, meta: unknown, rows: unknown): Promise<ImportResult> {
  const t = await getT();
  const who = await owner(t);
  if ("ok" in who) return who;
  if (typeof importId !== "string" || !UUID.test(importId) || !validImportMeta(meta)) {
    return { ok: false, message: t(START_AGAIN) };
  }
  const checked = checkedRows(rows, await requestToday(), meta.parts > 1);
  if (!checked) return { ok: false, message: t(ROWS_START_AGAIN) };
  // Every part it counts must already be there, or it would show as more than it holds.
  const { data, error } = await who.account.supabase.from("imported_history").select("part").eq("user_id", who.account.userId).eq("import_id", importId).returns<{ part: number }[]>();
  if (error) return { ok: false, message: t(TRY_AGAIN) };
  const have = new Set((data ?? []).map((r) => r.part));
  for (let n = 1; n < meta.parts; n++) if (!have.has(n)) return { ok: false, message: t("Part of that import didn't arrive. Start it again.") };
  const { name, kind, attachTo, source, parts } = meta;
  const result = await store(who.account, who.key, importId, 0, { v: 1, meta: { name, kind, attachTo, source, parts }, rows: checked }, t);
  if (result.ok) refresh();
  return result;
}

/** Remove an import whole: every part, finished or not. */
export async function removeImport(importId: unknown): Promise<ImportResult> {
  const t = await getT();
  const account = await currentAccount();
  if (!account) return { ok: false, message: t("Sign in to remove an import.") };
  if (typeof importId !== "string" || !UUID.test(importId)) return { ok: false, message: t("That import isn't here any more.") };
  const { error } = await account.supabase.from("imported_history").delete().eq("user_id", account.userId).eq("import_id", importId);
  if (error) return { ok: false, message: t("That didn't go through. Try again in a minute.") };
  refresh();
  return { ok: true };
}
