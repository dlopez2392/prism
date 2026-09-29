// src/lib/server/feed-token.ts — how a calendar feed's secret is looked up,
// and how its snapshot is kept. Shared by the account store (which writes
// both) and the public feed route (which reads them), so the two can never
// drift apart.

import { createHash } from "node:crypto";
import { openJson, sealJson, type VaultKey } from "./vault";

export function feedTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A snapshot is bill names, dates and amounts derived from a person's bank
 * data, so it is stored sealed (AES-256-GCM, the vault key) like every other
 * bank-derived value: the database holds `{ v: 2, sealed }` and never the
 * bills themselves.
 */
export function sealFeedSnapshot(snapshot: unknown, key: VaultKey): { v: 2; sealed: string } {
  return { v: 2, sealed: sealJson(snapshot, key) };
}

/** The snapshot inside a stored value, or null for anything this key didn't seal (an unsealed one included). */
export function openFeedSnapshot(stored: unknown, key: VaultKey): unknown {
  const s = stored as { v?: unknown; sealed?: unknown } | null;
  return s && s.v === 2 && typeof s.sealed === "string" ? openJson(s.sealed, key) : null;
}
