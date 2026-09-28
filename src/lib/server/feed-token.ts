// src/lib/server/feed-token.ts — how a calendar feed's secret is looked up.
// Shared by the account store (which writes the hash) and the public feed
// route (which reads by it), so the two can never drift apart.

import { createHash } from "node:crypto";

export function feedTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
