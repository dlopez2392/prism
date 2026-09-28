// GET /calendar/feed/<secret>.ics — a signed-in person's own calendar,
// fetched by Google, Apple or Outlook every few hours WITHOUT any cookies.
//
// The secret in the URL is the only credential. It is 32 random bytes; the
// database stores only its sha256, and the one function a signed-out caller
// may run trades that hash for the feed's snapshot — the person's repeating
// bills and paydays, refreshed as they use Prism. No balance, no transaction,
// no bank token is reachable from here. "Reset link" in Prism kills a leaked URL.

import { createClient } from "@supabase/supabase-js";
import type { CalendarOptions } from "@/lib/finance/calendar";
import { feedTokenHash } from "@/lib/server/feed-token";
import { calendarResponse } from "@/lib/server/calendar-response";
import { supabaseEnv } from "@/lib/supabase/config";

type Snapshot = { v: 1; streams: CalendarOptions["streams"]; accounts: CalendarOptions["accounts"] };

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const env = supabaseEnv();
  const token = (await params).token.replace(/\.ics$/, "");
  if (!env || !/^[A-Za-z0-9_-]{43}$/.test(token)) return notFound();

  const db = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc("calendar_feed_snapshot", { p_token_hash: feedTokenHash(token) });
  const snap = data as Snapshot | null;
  if (error || !snap || snap.v !== 1 || !Array.isArray(snap.streams) || !Array.isArray(snap.accounts)) return notFound();

  return calendarResponse(
    req,
    { streams: snap.streams, accounts: snap.accounts, today: new Date().toISOString().slice(0, 10) },
    // Private: the URL is a secret, so no shared cache may keep a copy.
    { feed: true, filename: "prism-bills.ics", cacheControl: "private, max-age=900", demo: false },
  );
}
