// src/lib/server/calendar-response.ts
//
// The shared half of the calendar routes: read the person's choices from
// the query string, build the file, and send it with headers every calendar
// app accepts. Choices arrive from a URL, so each is parsed to a closed set.

import { BRAND } from "@/lib/brand";
import { buildCalendar, parseReminder, type CalendarOptions } from "@/lib/finance/calendar";
import { detectRecurring } from "@/lib/finance/recurring";
import type { FinanceData } from "@/lib/finance/types";

/** From transactions (a download, the demo feed) or from a stored snapshot's streams (a person's feed). */
type Source = { accounts: CalendarOptions["accounts"]; today: FinanceData["today"] } & (
  | { transactions: FinanceData["transactions"] }
  | { streams: CalendarOptions["streams"] }
);

export function calendarResponse(
  req: Request,
  data: Source,
  mode: { feed: boolean; filename: string; cacheControl: string; demo: boolean },
): Response {
  const url = new URL(req.url);
  const q = url.searchParams;
  const paydays = q.get("paydays") !== "0";
  const body = buildCalendar({
    streams: "streams" in data ? data.streams : detectRecurring(data.transactions, data.today),
    accounts: data.accounts,
    today: data.today,
    now: new Date(),
    paydays,
    reminder: parseReminder(q.get("reminder")),
    amountsInTitles: q.get("amounts") !== "0",
    origin: url.origin,
    calendarName: `${BRAND.product}${mode.demo ? " demo" : ""}: bills${paydays ? " & paydays" : ""}`,
    feed: mode.feed,
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `${mode.feed ? "inline" : "attachment"}; filename="${mode.filename}"`,
      "Cache-Control": mode.cacheControl,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
