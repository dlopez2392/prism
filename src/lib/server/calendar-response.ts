// src/lib/server/calendar-response.ts
//
// The shared half of the calendar routes: read the person's choices from
// the query string, build the file in the language each route chose, and send
// it with headers every calendar app accepts. Choices arrive from a URL, so
// each is parsed to a closed set.

import { BRAND } from "@/lib/brand";
import { buildCalendar, dueReminders, parseReminder, type CalendarOptions, type DueReminder } from "@/lib/finance/calendar";
import { detectRecurring } from "@/lib/finance/recurring";
import type { FinanceData } from "@/lib/finance/types";
import type { T } from "@/lib/i18n/t";

/** From transactions and accounts (a download, the demo feed) or from a stored snapshot (a person's feed). */
type Source = { today: FinanceData["today"] } & (
  | { transactions: FinanceData["transactions"]; accounts: FinanceData["accounts"] }
  | { streams: CalendarOptions["streams"]; accounts: CalendarOptions["accounts"]; dues: DueReminder[] }
);

export function calendarResponse(
  req: Request,
  data: Source,
  mode: { feed: boolean; filename: string; cacheControl: string; demo: boolean; t: T },
): Response {
  const { t } = mode;
  const url = new URL(req.url);
  const q = url.searchParams;
  const paydays = q.get("paydays") !== "0";
  const body = buildCalendar({
    streams: "streams" in data ? data.streams : detectRecurring(data.transactions, data.today),
    dues: "streams" in data ? data.dues : dueReminders(data.accounts, data.today),
    accounts: data.accounts,
    today: data.today,
    now: new Date(),
    paydays,
    reminder: parseReminder(q.get("reminder")),
    amountsInTitles: q.get("amounts") !== "0",
    origin: url.origin,
    calendarName: mode.demo
      ? paydays
        ? t("{product} demo: bills & paydays", { product: BRAND.product })
        : t("{product} demo: bills", { product: BRAND.product })
      : paydays
        ? t("{product}: bills & paydays", { product: BRAND.product })
        : t("{product}: bills", { product: BRAND.product }),
    feed: mode.feed,
    t,
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
