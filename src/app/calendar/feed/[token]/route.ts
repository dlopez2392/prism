// GET /calendar/feed/<secret>.ics — a signed-in person's own calendar,
// fetched by Google, Apple or Outlook every few hours WITHOUT any cookies.
//
// The secret in the URL is the only credential. It is 32 random bytes; the
// database stores only its sha256, and the one function a signed-out caller
// may run trades that hash for the feed's snapshot — the person's repeating
// bills and paydays, refreshed as they use Prism. No balance, no transaction,
// no bank token is reachable from here. "Reset link" in Prism kills a leaked URL.
// The snapshot is stored sealed, so only this server, with the vault key,
// can read it: the database never holds the bills themselves. It names the
// language the person's visits were in, and the calendar is written in it.
// With billing on, the feed is part of Prism Plus: its owner's plan is asked
// by the same secret (calendar_feed_plus), and without Plus it's empty.

import { createClient } from "@supabase/supabase-js";
import { billingConfig } from "@/lib/billing/plus";
import { validDue, type CalendarOptions } from "@/lib/finance/calendar";
import { feedTokenHash, openFeedSnapshot } from "@/lib/server/feed-token";
import { vaultKey, type VaultKey } from "@/lib/server/vault";
import { calendarResponse } from "@/lib/server/calendar-response";
import { isLocale } from "@/lib/i18n/locale";
import { translator } from "@/lib/i18n/translator";
import { supabaseEnv } from "@/lib/supabase/config";

type Snapshot = { v: 1; streams: CalendarOptions["streams"]; accounts: CalendarOptions["accounts"]; dues?: unknown; lang?: unknown };

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const env = supabaseEnv();
  const token = (await params).token.replace(/\.ics$/, "");
  if (!env || !/^[A-Za-z0-9_-]{43}$/.test(token)) return notFound();

  const db = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const billing = billingConfig();
  const [{ data, error }, plus] = await Promise.all([
    db.rpc("calendar_feed_snapshot", { p_token_hash: feedTokenHash(token) }),
    // A calendar that keeps itself up to date is part of Prism Plus. Can't be asked: it errs toward the person.
    billing ? db.rpc("calendar_feed_plus", { p_token_hash: feedTokenHash(token), p_livemode: billing.livemode }) : Promise.resolve({ data: true, error: null }),
  ]);
  let key: VaultKey | null = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  const snap = (key && !error ? openFeedSnapshot(data, key) : null) as Snapshot | null;
  if (error || !snap || snap.v !== 1 || !Array.isArray(snap.streams) || !Array.isArray(snap.accounts)) return notFound();
  const lang = translator(isLocale(snap.lang) ? snap.lang : "en");
  // Prism Plus has ended: the calendar stays subscribed but empty, rather than showing bills that stopped being checked.
  // It fills again on its own once Plus is back.
  if (plus.data === false) {
    return calendarResponse(req, { streams: [], accounts: [], dues: [], today: new Date().toISOString().slice(0, 10) }, {
      feed: true,
      filename: "prism-bills.ics",
      cacheControl: "private, max-age=900",
      demo: false,
      t: lang,
    });
  }

  return calendarResponse(
    req,
    // Due payments arrived with card and loan terms; a snapshot from before them simply has none.
    { streams: snap.streams, accounts: snap.accounts, dues: Array.isArray(snap.dues) ? snap.dues.filter(validDue) : [], today: new Date().toISOString().slice(0, 10) },
    // Private: the URL is a secret, so no shared cache may keep a copy.
    // A snapshot from before languages has none, and was English.
    { feed: true, filename: "prism-bills.ics", cacheControl: "private, max-age=900", demo: false, t: lang },
  );
}
