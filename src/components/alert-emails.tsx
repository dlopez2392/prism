"use client";

// src/components/alert-emails.tsx
//
// Alert emails on the Account page: on or off, which kinds, and whether they
// may show dollar amounts. One Save for the card (DESIGN.md: one primary
// action per view).

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { CircleCheck } from "lucide-react";
import { buttonPrimary, FormMessage } from "@/components/dialog";
import { ALERT_CHOICE_LABELS, ALERT_CHOICES, type AlertChoice } from "@/lib/alerts/choices";
import { BRAND } from "@/lib/brand";
import { IDLE } from "@/lib/finance/plan";
import { saveAlertEmails } from "@/lib/server/alert-actions";

export type AlertEmailSettings = { on: boolean; kinds: AlertChoice[]; amounts: boolean };

const box = "mt-0.5 size-4 shrink-0 accent-button";

export function AlertEmails({ settings, email }: { settings: AlertEmailSettings; email: string }) {
  const [state, action, pending] = useActionState(saveAlertEmails, IDLE);
  const [on, setOn] = useState(settings.on);
  const kindsError = state.status === "error" ? state.fields?.kinds : undefined;

  // By hand, not <form action>: React resets a form after its action, which would undo the boxes on an error.
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => action(form));
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4 space-y-4">
      <label className="flex cursor-pointer items-start gap-2.5 rounded-ctl bg-surface-2 p-3 text-sm text-ink-1">
        <input type="checkbox" name="on" checked={on} onChange={(e) => setOn(e.target.checked)} className={box} />
        <span>
          <span className="font-semibold">Email me alerts</span>
          <span className="mt-0.5 block text-xs text-ink-2">To {email}, at most once a day, only when there&apos;s something new.</span>
        </span>
      </label>

      {/* Disabled boxes aren't sent, which is why turning emails off saves only that: the choices wait for next time. */}
      <fieldset disabled={!on} className="space-y-2.5 disabled:opacity-60" aria-describedby={kindsError ? "alert-kinds-error" : undefined}>
        <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">What to email about</legend>
        {ALERT_CHOICES.map((kind) => (
          <label key={kind} className="flex items-start gap-2.5 text-sm text-ink-1">
            <input type="checkbox" name="kinds" value={kind} defaultChecked={settings.kinds.includes(kind)} className={box} />
            <span>
              {ALERT_CHOICE_LABELS[kind].label}
              <span className="block text-xs text-ink-3">{ALERT_CHOICE_LABELS[kind].hint}</span>
            </span>
          </label>
        ))}
        {kindsError ? (
          <p id="alert-kinds-error" role="alert" className="text-xs font-semibold text-crit-ink">
            {kindsError}
          </p>
        ) : null}
        <label className="flex items-start gap-2.5 border-t border-line pt-3 text-sm text-ink-1">
          <input type="checkbox" name="amounts" defaultChecked={settings.amounts} className={box} />
          <span>
            Show dollar amounts
            <span className="block text-xs text-ink-3">Subjects can show on a lock screen. Without amounts, emails say what happened and you open {BRAND.product} for the numbers.</span>
          </span>
        </label>
      </fieldset>

      {kindsError ? null : <FormMessage state={state} />}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonPrimary}>
          {pending ? "Saving…" : "Save"}
        </button>
        {/* Always in the DOM so screen readers announce it. */}
        <p role="status" className="flex items-center gap-1 text-xs font-semibold text-good-ink">
          {state.status === "saved" ? (
            <>
              <CircleCheck aria-hidden className="size-3.5" />
              {state.message}
            </>
          ) : null}
        </p>
      </div>
    </form>
  );
}
