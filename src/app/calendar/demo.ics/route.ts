// GET /calendar/demo.ics — the demo household's bills as a SUBSCRIBABLE feed.
//
// Fictional data only, so it is public and cacheable; it never reads cookies,
// so a linked bank can never leak through it. Paste the URL into Google
// Calendar, Apple Calendar or Outlook and it refreshes itself — the same
// shape a per-person feed of real bills will take once Prism has accounts.

import { buildDemoData } from "@/lib/finance/demo";
import { calendarResponse } from "@/lib/server/calendar-response";

export function GET(req: Request) {
  const data = buildDemoData(new Date().toISOString().slice(0, 10));
  return calendarResponse(req, data, { feed: true, filename: "prism-demo.ics", cacheControl: "public, max-age=3600, s-maxage=3600", demo: true });
}
