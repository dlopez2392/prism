// GET /calendar/bills.ics — this person's bill reminders as a file to import.
//
// Built from whatever this browser can see (its own linked banks, or the demo
// household), so it needs the person's cookies and is never cached or shared;
// and written in the page's language, which those cookies (or the browser) say.
// A calendar app subscribing to a URL fetches WITHOUT those cookies, which is
// why a live, self-updating feed of real bills waits for Prism accounts (a
// revocable per-person feed token); a download needs nothing stored.

import { getT } from "@/lib/i18n/server";
import { getFinance } from "@/lib/server/finance";
import { calendarResponse } from "@/lib/server/calendar-response";

export async function GET(req: Request) {
  const data = await getFinance();
  return calendarResponse(req, data, { feed: false, filename: "prism-bills.ics", cacheControl: "private, no-store", demo: data.source === "demo", t: await getT() });
}
