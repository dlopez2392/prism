"use client";

// src/components/subscriptions.tsx
//
// The lists on the Subscriptions page, and what a person can do from them:
// open the service's own cancel page; say they cancelled one (Prism Plus,
// and Prism then watches for a charge that shouldn't come); say a charge
// isn't a subscription, or that one under "other repeating charges" is; and
// add, change or remove the ones Prism can't see. Every change takes effect
// at once, with an Undo beside the message, which sits above the lists so it
// stays on screen when the row it was about moves to another list.

import { startTransition, useActionState, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { CircleCheck, ExternalLink, Plus, Repeat } from "lucide-react";
import clsx from "clsx";
import { buttonGhost, buttonPrimary, buttonSmall, Dialog, FormMessage, MoneyInput, SelectInput, TextInput } from "@/components/dialog";
import { useT } from "@/components/locale";
import { Card, CardHeader, EmptyState, StatusPill } from "@/components/ui";
import { pricingFor } from "@/lib/billing/plans";
import { OWN_CADENCES, type OwnSub } from "@/lib/finance/details";
import { money, shortDate } from "@/lib/finance/format";
import { scheduleText } from "@/lib/finance/income";
import { dollarsInput, IDLE, type PlanFormState } from "@/lib/finance/plan";
import type { CancelledRow, CancelLink, OtherCharge, SubscriptionRow } from "@/lib/finance/subscriptions";
import type { ISODate } from "@/lib/finance/types";
import type { T } from "@/lib/i18n/t";
import {
  cancelSubscription,
  markSubscription,
  putOwnSubscription,
  removeOwnSubscription,
  saveOwnSubscription,
  type SubscriptionState,
} from "@/lib/server/subscription-actions";

type Message = { text: string; undo: (() => Promise<SubscriptionState>) | null; error?: true };

/** The service's own page for cancelling, in a new tab: it's their site, not Prism's. */
function CancelPage({ link }: { link: CancelLink }) {
  const t = useT();
  return (
    <a href={link.url} target="_blank" rel="noopener noreferrer" className={buttonSmall} aria-label={t("Where to cancel {service} (opens their site)", { service: link.service })}>
      <ExternalLink aria-hidden className="size-3.5" />
      {t("Where to cancel")}
    </a>
  );
}

/** "Every month · next Oct 3": how often, and when next. */
function when(cadence: SubscriptionRow["cadence"], next: ISODate, t: T): string {
  return t("{every} · next {date}", { every: scheduleText(cadence, undefined, t), date: shortDate(next, t.locale) });
}

export function SubscriptionsBoard({
  active,
  cancelled,
  others,
  own,
  canEdit,
  plus,
}: {
  active: SubscriptionRow[];
  cancelled: CancelledRow[];
  others: OtherCharge[];
  /** What the person added by hand, as they gave it: for changing one, and for Undo. */
  own: OwnSub[];
  /** A signed-in person's own money: the example household can't be changed. */
  canEdit: boolean;
  /** Saying one was cancelled is part of Prism Plus. */
  plus: boolean;
}) {
  const t = useT();
  const [message, setMessage] = useState<Message | null>(null);
  const [pending, start] = useTransition();
  const addDialog = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<{ sub: OwnSub | null; session: number }>({ sub: null, session: 0 });

  const run = (act: () => Promise<SubscriptionState>, undo: (() => Promise<SubscriptionState>) | null) =>
    start(async () => {
      const r = await act();
      setMessage(r.status === "saved" ? { text: r.message, undo } : { text: r.status === "error" ? r.message : "", undo: null, error: true });
    });
  const undoNow = () => {
    const undo = message?.undo;
    if (undo) run(undo, null);
  };
  const openForm = (sub: OwnSub | null) => {
    setEditing((e) => ({ sub, session: e.session + 1 }));
    addDialog.current?.showModal();
  };

  const add = canEdit ? (
    <button type="button" onClick={() => openForm(null)} className={buttonSmall}>
      <Plus aria-hidden className="size-4" />
      {t("Add one")}
    </button>
  ) : null;

  return (
    <div className="space-y-5">
      <p role="status" className={clsx("min-h-5 text-xs font-semibold", !message && "sr-only")}>
        {message ? (
          <span className={message.error ? "text-crit-ink" : "inline-flex flex-wrap items-center gap-1 text-good-ink"}>
            {message.error ? null : <CircleCheck aria-hidden className="size-3.5 shrink-0" />}
            {message.text}
            {message.undo ? (
              <button type="button" onClick={undoNow} disabled={pending} className="ml-2 font-semibold text-accent-ink underline-offset-2 hover:underline">
                {t("Undo")}
              </button>
            ) : null}
          </span>
        ) : null}
      </p>

      <Card className="p-5 sm:p-6">
        <CardHeader
          title={t("Your subscriptions")}
          subtitle={t("Most expensive first. Prism finds them from charges that repeat at the same price; add any it can't see.")}
          action={add}
        />
        {active.length ? (
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {active.map((r) => {
              const added = r.source === "added" ? own.find((o) => o.id === r.key) : undefined;
              return (
                <li key={`${r.source}:${r.streamId ?? r.key}`} className="py-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-ink-1 [overflow-wrap:anywhere]">{r.name}</div>
                      <div className="text-xs text-ink-3">{when(r.cadence, r.nextDate, t)}</div>
                      <Badges row={r} t={t} />
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="num text-sm font-bold text-ink-1">{money(r.amount)}</div>
                      <div className="text-xs text-ink-3">{r.cadence === "annual" ? t("{amount} a month", { amount: money(r.monthly) }) : t("{amount} a year", { amount: money(r.yearly) })}</div>
                    </div>
                  </div>
                  <Actions>
                    {r.cancel ? <CancelPage link={r.cancel} /> : null}
                    {canEdit && r.source !== "added" ? (
                      plus ? (
                        <button
                          type="button"
                          disabled={pending}
                          className={buttonSmall}
                          onClick={() => run(() => cancelSubscription(r.key, true), () => cancelSubscription(r.key, false))}
                        >
                          {t("I cancelled it")}
                        </button>
                      ) : (
                        <Link href={pricingFor("subscriptions")} className={buttonSmall}>
                          {t("I cancelled it")}
                        </Link>
                      )
                    ) : null}
                    {canEdit && r.source !== "added" ? (
                      <button type="button" disabled={pending} className={buttonSmall} onClick={() => run(() => markSubscription(r.key, false), () => markSubscription(r.key, null))}>
                        {t("Not a subscription")}
                      </button>
                    ) : null}
                    {canEdit && added ? (
                      <>
                        <button type="button" disabled={pending} className={buttonSmall} onClick={() => openForm(added)}>
                          {t("Change")}
                        </button>
                        <button type="button" disabled={pending} className={buttonSmall} onClick={() => run(() => removeOwnSubscription(added.id), () => putOwnSubscription(added))}>
                          {t("Remove")}
                        </button>
                      </>
                    ) : null}
                  </Actions>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={Repeat}
            title={t("No subscriptions spotted yet")}
            body={t("Anything that charges you the same amount every week, month or year shows up here, with what it all costs and where to cancel. Add one Prism can't see, like one paid in cash.")}
            action={add ?? undefined}
          />
        )}
      </Card>

      {cancelled.length ? (
        <Card className="p-5 sm:p-6">
          <CardHeader title={t("Cancelled")} subtitle={t("Prism keeps watching these. A charge that comes after you cancelled shows here, and in your alerts.")} />
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {cancelled.map((c) => {
              const last = c.chargedSince.at(-1);
              return (
                <li key={c.key} className="py-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-ink-1 [overflow-wrap:anywhere]">{c.name}</div>
                      <div className="text-xs text-ink-3">{t("You cancelled it on {date}", { date: shortDate(c.on, t.locale) })}</div>
                      <div className="mt-1">
                        {last ? (
                          <StatusPill status="crit">{t("Charged you {amount} on {date}", { amount: money(last.amount), date: shortDate(last.date, t.locale) })}</StatusPill>
                        ) : (
                          <StatusPill status="good">{t("No charge since")}</StatusPill>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="num text-sm font-bold text-ink-1">{money(c.yearly)}</div>
                      <div className="text-xs text-ink-3">{t("saved a year")}</div>
                    </div>
                  </div>
                  <Actions>
                    {last && c.cancel ? <CancelPage link={c.cancel} /> : null}
                    {canEdit && plus ? (
                      <button type="button" disabled={pending} className={buttonSmall} onClick={() => run(() => cancelSubscription(c.key, false), () => cancelSubscription(c.key, true))}>
                        {t("It isn't cancelled")}
                      </button>
                    ) : null}
                  </Actions>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {others.length ? (
        <Card className="p-5 sm:p-6">
          <CardHeader title={t("Other repeating charges")} subtitle={t("Bills and payments that come round on a rhythm. If one of them is a subscription, say so and it counts in your total.")} />
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {others.map((o) => (
              <li key={o.streamId} className="py-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-ink-1 [overflow-wrap:anywhere]">{o.name}</div>
                    <div className="text-xs text-ink-3">{when(o.cadence, o.nextDate, t)}</div>
                  </div>
                  <div className="num shrink-0 text-right text-sm font-bold text-ink-1">{o.variable ? t("About {amount}", { amount: money(o.amount) }) : money(o.amount)}</div>
                </div>
                <Actions>
                  {canEdit ? (
                    <button type="button" disabled={pending} className={buttonSmall} onClick={() => run(() => markSubscription(o.key, true), () => markSubscription(o.key, null))}>
                      {t("It's a subscription")}
                    </button>
                  ) : null}
                </Actions>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {canEdit ? (
        <Dialog
          dialogRef={addDialog}
          title={editing.sub ? editing.sub.name : t("Add a subscription")}
          description={t("One Prism can't see, like one paid in cash or on a card that isn't connected. It counts in your subscription total, not in your forecast.")}
          icon={Repeat}
        >
          <OwnForm
            key={editing.session}
            sub={editing.sub}
            onDone={(text) => {
              setMessage({ text, undo: null });
              addDialog.current?.close();
            }}
            onCancel={() => addDialog.current?.close()}
          />
        </Dialog>
      ) : null}
    </div>
  );
}

/** A row's buttons, under it; nothing at all when it has none. */
function Actions({ children }: { children: ReactNode }) {
  const any = (Array.isArray(children) ? children : [children]).some((c) => c !== null && c !== false && c !== undefined);
  return any ? <div className="mt-2 flex flex-wrap gap-2">{children}</div> : null;
}

/** What's worth knowing about one at a glance: each a word with its icon, never colour alone. */
function Badges({ row, t }: { row: SubscriptionRow; t: T }) {
  const badges: ReactNode[] = [];
  if (row.priceChange && row.priceChange.to > row.priceChange.from)
    badges.push(
      <StatusPill key="up" status="warn">
        {t("Up from {amount}", { amount: money(row.priceChange.from) })}
      </StatusPill>,
    );
  if (row.started)
    badges.push(
      <StatusPill key="new" status="neutral">
        {row.afterTrial ? t("Started after a free trial, {date}", { date: shortDate(row.started, t.locale) }) : t("New since {date}", { date: shortDate(row.started, t.locale) })}
      </StatusPill>,
    );
  if (row.source === "added")
    badges.push(
      <StatusPill key="added" status="neutral">
        {t("Added by you")}
      </StatusPill>,
    );
  if (row.source === "marked")
    badges.push(
      <StatusPill key="marked" status="neutral">
        {t("Marked by you")}
      </StatusPill>,
    );
  if (row.billedBy)
    badges.push(
      <StatusPill key="store" status="neutral">
        {row.billedBy === "apple" ? t("Billed by Apple") : t("Billed by Google")}
      </StatusPill>,
    );
  return badges.length ? <div className="mt-1 flex flex-wrap gap-1.5">{badges}</div> : null;
}

const CADENCE_OPTIONS = OWN_CADENCES;

function OwnForm({ sub, onDone, onCancel }: { sub: OwnSub | null; onDone: (message: string) => void; onCancel: () => void }) {
  const t = useT();
  const [state, action, pending] = useActionState(async (prev: PlanFormState, form: FormData) => {
    const next = await saveOwnSubscription(prev, form);
    if (next.status === "saved") onDone(next.message);
    return next;
  }, IDLE);
  const errors = state.status === "error" ? (state.fields ?? {}) : {};

  // By hand, not <form action>: React resets a form after its action, which would throw away what was typed.
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => action(form));
  }

  return (
    <form onSubmit={submit} noValidate>
      <input type="hidden" name="id" value={sub?.id ?? ""} />
      <div className="grid gap-4">
        <TextInput name="name" label={t("Name")} defaultValue={sub?.name ?? ""} error={errors.name} maxLength={60} autoFocus />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MoneyInput name="amount" label={t("What it costs each time")} defaultValue={sub ? dollarsInput(sub.amount) : ""} error={errors.amount} />
          <SelectInput
            name="cadence"
            label={t("How often")}
            showLabel
            defaultValue={sub?.cadence ?? "monthly"}
            invalid={Boolean(errors.cadence)}
            options={CADENCE_OPTIONS.map((c) => ({ value: c, label: scheduleText(c, undefined, t) }))}
          />
        </div>
        <DateField name="next" label={t("Its next charge")} defaultValue={sub?.next ?? ""} error={errors.next} />
        <FormMessage state={state} />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} className={buttonGhost}>
            {t("Cancel")}
          </button>
          <button type="submit" disabled={pending} className={buttonPrimary}>
            {sub ? t("Save") : t("Add")}
          </button>
        </div>
      </div>
    </form>
  );
}

/** A day, as the browser's own date picker gives it (YYYY-MM-DD). */
function DateField({ name, label, defaultValue, error }: { name: string; label: string; defaultValue: string; error?: string }) {
  const id = `${name}-field`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      <input
        id={id}
        type="date"
        name={name}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-note` : undefined}
        className="h-10 w-full rounded-ctl border border-line-strong bg-surface-2 px-3 text-sm text-ink-1 focus:border-[var(--focus)] aria-[invalid=true]:border-crit"
      />
      {error ? (
        <p id={`${id}-note`} className="mt-1 text-xs font-medium text-crit-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
