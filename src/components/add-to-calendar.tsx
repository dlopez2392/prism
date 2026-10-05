"use client";

// src/components/add-to-calendar.tsx
//
// "Add to calendar": every bill, subscription and payday Prism found, as
// reminders in Google, Apple or Outlook. Anyone can download them as a file.
// A signed-in person also gets a private link their calendar app follows, so
// the reminders keep themselves up to date; the demo household has a public
// one to try. Signed out with real money, sign-in is the way to a live link.

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { CalendarPlus, Check, Copy, Download, ExternalLink, RotateCcw } from "lucide-react";
import { buttonPrimary, buttonSmall, Dialog } from "@/components/dialog";
import { useT } from "@/components/locale";
import { REMINDERS, type Reminder } from "@/lib/finance/calendar";
import { calendarFeed, type FeedState } from "@/lib/server/calendar-actions";
import { msg } from "@/lib/i18n/t";

/** REMINDERS' choices as the dialog says them, in the page's language (the calendar file itself stays English). */
const REMINDER_LABELS: Record<Reminder, string> = {
  day_before: msg("The day before, 9 AM"),
  same_day: msg("On the day, 9 AM"),
  three_days: msg("Three days before, 9 AM"),
  none: msg("No alerts"),
};

type Props = {
  demo: boolean;
  count: number;
  /** Signed in: the path of their own feed, or null until they create one. Undefined when signed out. */
  personal?: { path: string | null };
  /** Accounts exist here but nobody is signed in: where to go for a live link. */
  signIn?: boolean;
};

export function AddToCalendar({ demo, count, personal, signIn }: Props) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [reminder, setReminder] = useState<Reminder>("day_before");
  const [paydays, setPaydays] = useState(true);
  const [amounts, setAmounts] = useState(true);
  // Read on open, not during render, so the server and browser agree on markup.
  const [origin, setOrigin] = useState("");
  const [feed, feedAction, feedPending] = useActionState<FeedState, FormData>(calendarFeed, { path: personal?.path ?? null });

  const params = new URLSearchParams({ reminder });
  if (!paydays) params.set("paydays", "0");
  if (!amounts) params.set("amounts", "0");
  const download = `/calendar/bills.ics?${params}`;

  function open() {
    setOrigin(window.location.origin);
    dialog.current?.showModal();
  }

  return (
    <>
      <button type="button" onClick={open} className={buttonSmall}>
        <CalendarPlus aria-hidden className="size-4" />
        {t("Add to calendar")}
      </button>
      <Dialog
        dialogRef={dialog}
        title={t("Bill reminders in your calendar")}
        description={count === 1 ? t("1 repeating bill, in Google, Apple or Outlook.") : t("{n} repeating bills and paydays, in Google, Apple or Outlook.", { n: count })}
        icon={CalendarPlus}
      >
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-semibold text-ink-2">{t("Alert me")}</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {REMINDERS.map((r) => (
              <label key={r.id} className="flex h-10 cursor-pointer items-center gap-2.5 rounded-ctl border border-line px-3 text-sm font-medium text-ink-1 hover:bg-surface-3 has-checked:border-accent has-checked:bg-accent-soft">
                <input type="radio" name="reminder" value={r.id} checked={reminder === r.id} onChange={() => setReminder(r.id)} className="accent-button" />
                {t(REMINDER_LABELS[r.id])}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-4 space-y-2.5">
          <label className="flex items-start gap-2.5 text-sm text-ink-1">
            <input type="checkbox" checked={paydays} onChange={(e) => setPaydays(e.target.checked)} className="mt-0.5 size-4 accent-button" />
            <span>{t("Include paydays")}</span>
          </label>
          <label className="flex items-start gap-2.5 text-sm text-ink-1">
            <input type="checkbox" checked={amounts} onChange={(e) => setAmounts(e.target.checked)} className="mt-0.5 size-4 accent-button" />
            <span>
              {t("Show amounts in event titles")}
              <span className="block text-xs text-ink-3">{t("Titles can show on your lock screen. Amounts always stay in the event notes.")}</span>
            </span>
          </label>
        </div>

        {personal ? (
          <section className="mt-5 rounded-ctl bg-surface-2 p-4">
            <h3 className="text-sm font-bold text-ink-1">{t("Your calendar link")}</h3>
            {feed.path ? (
              <>
                <p className="mt-0.5 text-xs text-ink-3">{t("Your calendar app checks it every few hours, so new bills and changed amounts appear on their own.")}</p>
                <Subscribe url={`${origin}${feed.path}?${params}`} />
                <form action={feedAction} className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span className="text-ink-3">{t("Anyone with this link can see your bill names and amounts.")}</span>
                  <button type="submit" name="intent" value="reset" disabled={feedPending} className="inline-flex items-center gap-1 font-semibold text-accent-ink hover:underline disabled:opacity-60">
                    <RotateCcw aria-hidden className="size-3.5" />
                    {t("Reset link")}
                  </button>
                  <button type="submit" name="intent" value="off" disabled={feedPending} className="font-semibold text-ink-2 hover:underline disabled:opacity-60">
                    {t("Turn off")}
                  </button>
                </form>
              </>
            ) : (
              <form action={feedAction}>
                <p className="mt-0.5 text-xs text-ink-3">{t("A private link your calendar app follows, so reminders keep themselves up to date.")}</p>
                <button type="submit" name="intent" value="create" disabled={feedPending} className={`${buttonPrimary} mt-3 w-full`}>
                  <CalendarPlus aria-hidden className="size-4" />
                  {feedPending ? t("Creating…") : t("Create my calendar link")}
                </button>
              </form>
            )}
            {feed.error ? (
              <p role="alert" className="mt-2 text-xs font-medium text-crit-ink">
                {feed.error}
              </p>
            ) : null}
          </section>
        ) : null}

        <a href={download} download="prism-bills.ics" className={`${personal ? buttonSmall : buttonPrimary} mt-5 w-full justify-center`}>
          <Download aria-hidden className="size-4" />
          {t("Download calendar file")}
        </a>
        <p className="mt-2 text-xs text-ink-3">
          {t("The file adds a year of reminders. On a computer, Google Calendar takes it under Settings → Import & export. Download again any time to refresh the amounts.")}
        </p>

        {!personal && demo ? (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-sm font-bold text-ink-1">{t("Or subscribe to the demo calendar")}</h3>
            <p className="mt-0.5 text-xs text-ink-3">{t("It follows Alex's made-up bills and keeps itself up to date.")}</p>
            <Subscribe url={`${origin}/calendar/demo.ics?${params}`} />
          </div>
        ) : null}
        {!personal && signIn ? (
          <p className="mt-4 text-xs text-ink-2">
            <Link href="/sign-in" className="font-semibold text-accent-ink hover:underline">
              {t("Sign in")}
            </Link>{" "}
            {t("for a private calendar link that keeps your own reminders up to date.")}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}

/** Google, Apple and a copyable link (for Outlook) for one calendar URL. */
function Subscribe({ url }: { url: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const webcal = url.replace(/^https?:/, "webcal:");
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <a href={`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noopener noreferrer" className={buttonSmall}>
        <ExternalLink aria-hidden className="size-4" />
        Google Calendar
      </a>
      <a href={webcal} className={buttonSmall}>
        <CalendarPlus aria-hidden className="size-4" />
        Apple Calendar
      </a>
      <button type="button" onClick={copy} className={buttonSmall}>
        {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
        {copied ? t("Link copied") : t("Copy link for Outlook")}
      </button>
      <span role="status" className="sr-only">
        {copied ? t("Calendar link copied.") : ""}
      </span>
    </div>
  );
}
