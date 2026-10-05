"use server";

// src/lib/server/calendar-actions.ts
//
// A signed-in person's self-updating calendar link: create it, reset it (the
// old URL stops working at once — for a link shared by mistake), or turn it
// off. Creating or resetting also writes a fresh snapshot, so the calendar is
// right from its first fetch.

import { getT } from "@/lib/i18n/server";
import { currentAccount } from "@/lib/supabase/server";
import { accountFeedToken, removeAccountFeed, saveFeedSnapshot } from "./account-store";
import { feedSnapshot } from "@/lib/finance/calendar";
import { getFinance } from "./finance";
import { vaultKey, type VaultKey } from "./vault";

export type FeedState = { path: string | null; error?: string };

export async function calendarFeed(prev: FeedState, form: FormData): Promise<FeedState> {
  const t = await getT();
  const account = await currentAccount();
  if (!account) return { path: null, error: t("Sign in to get a calendar link.") };
  let key: VaultKey | null = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  if (!key) return { path: prev.path, error: t("Calendar links aren't switched on for this version of Prism yet.") };

  const intent = form.get("intent");
  try {
    if (intent === "off") {
      await removeAccountFeed(account);
      return { path: null };
    }
    const token = await accountFeedToken(account, key, { create: true, reset: intent === "reset" });
    const data = await getFinance();
    // Nothing real linked yet: publish an empty calendar, never the demo household's bills.
    await saveFeedSnapshot(account, feedSnapshot(data.source === "demo" ? { transactions: [], accounts: [], today: data.today } : data), key);
    return { path: `/calendar/feed/${token}.ics` };
  } catch {
    return { path: prev.path, error: t("That didn't work. Try again in a moment.") };
  }
}
