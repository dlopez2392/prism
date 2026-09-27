"use client";

// src/components/add-to-calendar.tsx
//
// "Add to calendar": every bill, subscription and payday Prism found, as
// reminders in Google, Apple or Outlook. The person's own bills come as a
// file to import (a subscribed calendar is fetched without their cookies, so
// a live feed of real bills needs accounts first). The demo household also
// offers a real subscription, so the self-updating feed can be tried today.

import { useRef, useState } from "react";
import { CalendarPlus, Check, Copy, Download, ExternalLink } from "lucide-react";
import { buttonPrimary, buttonSmall, Dialog } from "@/components/dialog";
import { REMINDERS, type Reminder } from "@/lib/finance/calendar";

export function AddToCalendar({ demo, count }: { demo: boolean; count: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reminder, setReminder] = useState<Reminder>("day_before");
  const [paydays, setPaydays] = useState(true);
  const [amounts, setAmounts] = useState(true);
  // Read on open, not during render, so the server and browser agree on markup.
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  const params = new URLSearchParams({ reminder });
  if (!paydays) params.set("paydays", "0");
  if (!amounts) params.set("amounts", "0");
  const download = `/calendar/bills.ics?${params}`;
  const feed = `${origin}/calendar/demo.ics?${params}`;
  const webcal = feed.replace(/^https?:/, "webcal:");

  function open() {
    setOrigin(window.location.origin);
    setCopied(false);
    dialog.current?.showModal();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(feed);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <button type="button" onClick={open} className={buttonSmall}>
        <CalendarPlus aria-hidden className="size-4" />
        Add to calendar
      </button>
      <Dialog
        dialogRef={dialog}
        title="Bill reminders in your calendar"
        description={`${count} repeating ${count === 1 ? "bill" : "bills and paydays"}, in Google, Apple or Outlook.`}
        icon={CalendarPlus}
      >
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-semibold text-ink-2">Alert me</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {REMINDERS.map((r) => (
              <label key={r.id} className="flex h-10 cursor-pointer items-center gap-2.5 rounded-ctl border border-line px-3 text-sm font-medium text-ink-1 hover:bg-surface-3 has-checked:border-accent has-checked:bg-accent-soft">
                <input type="radio" name="reminder" value={r.id} checked={reminder === r.id} onChange={() => setReminder(r.id)} className="accent-button" />
                {r.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-4 space-y-2.5">
          <label className="flex items-start gap-2.5 text-sm text-ink-1">
            <input type="checkbox" checked={paydays} onChange={(e) => setPaydays(e.target.checked)} className="mt-0.5 size-4 accent-button" />
            <span>Include paydays</span>
          </label>
          <label className="flex items-start gap-2.5 text-sm text-ink-1">
            <input type="checkbox" checked={amounts} onChange={(e) => setAmounts(e.target.checked)} className="mt-0.5 size-4 accent-button" />
            <span>
              Show amounts in event titles
              <span className="block text-xs text-ink-3">Titles can show on your lock screen. Amounts always stay in the event notes.</span>
            </span>
          </label>
        </div>

        <a href={download} download="prism-bills.ics" className={`${buttonPrimary} mt-5 w-full`}>
          <Download aria-hidden className="size-4" />
          Download calendar file
        </a>
        <p className="mt-2 text-xs text-ink-3">
          Open the file and your calendar adds a year of reminders. On a computer, Google Calendar takes it under Settings → Import &amp; export. Download
          again any time to refresh the amounts.
        </p>

        {demo ? (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-sm font-bold text-ink-1">Or subscribe to the demo calendar</h3>
            <p className="mt-0.5 text-xs text-ink-3">It follows Alex&apos;s made-up bills and keeps itself up to date.</p>
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
                {copied ? "Link copied" : "Copy link for Outlook"}
              </button>
            </div>
            <p role="status" className="sr-only">
              {copied ? "Calendar link copied." : ""}
            </p>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
