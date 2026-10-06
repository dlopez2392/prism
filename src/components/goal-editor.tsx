"use client";

// src/components/goal-editor.tsx
//
// Add, edit and delete a savings goal, saved to the account (or this device
// when signed out), or, in the Household view, to the household. The same form
// serves all three: a new goal starts blank with a finish line a year out; an
// existing one opens with its numbers and a two-step delete, because a goal's
// history is the one thing an edit can't bring back. A goal can follow an
// account instead of a typed amount: then what's saved IS that balance.

import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import { CircleCheck, Pencil, PiggyBank, Plus, RotateCcw, Trash2 } from "lucide-react";
import clsx from "clsx";
import { buttonGhost, buttonPrimary, buttonSmall, Dialog, FormMessage, MoneyInput, SelectInput, TextInput } from "@/components/dialog";
import { useT } from "@/components/locale";
import { addMonths } from "@/lib/finance/dates";
import { capitalized, money0, monthLong } from "@/lib/finance/format";
import { dollarsInput, GOAL_EMOJIS, GOAL_HORIZON_YEARS, GOAL_NAME_MAX, IDLE, type GoalSettings, type PlanFormState } from "@/lib/finance/plan";
import { msg } from "@/lib/i18n/t";
import { deleteGoal, restoreGoals, saveGoal } from "@/lib/server/plan-actions";

const EMOJI_NAMES: Record<(typeof GOAL_EMOJIS)[number], string> = {
  "🛟": msg("Life ring"),
  "🏡": msg("House"),
  "🗾": msg("Map"),
  "💻": msg("Laptop"),
  "🚗": msg("Car"),
  "🎓": msg("Graduation cap"),
  "💍": msg("Ring"),
  "👶": msg("Baby"),
  "🏖️": msg("Beach"),
  "🎁": msg("Gift"),
  "🐶": msg("Dog"),
  "🌱": msg("Seedling"),
};

/** "01" … "12", for the month picker: each month named in the page's language. */
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

type Mode = "new" | "edit" | "empty";

/** An account a goal can follow: its balance becomes what's saved. */
export type FollowableAccount = { id: string; name: string; detail: string; balance: number };

export function GoalEditor({
  goal,
  others,
  today,
  mode,
  signedIn = false,
  household = false,
  accounts = [],
}: {
  goal?: GoalSettings;
  others: GoalSettings[];
  today: string;
  mode: Mode;
  signedIn?: boolean;
  /** A household goal: saved for everyone in it. */
  household?: boolean;
  /** Accounts the goal may follow (the whole list; ones other goals follow are left out here). */
  accounts?: FollowableAccount[];
}) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [session, setSession] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  function open() {
    setSession((s) => s + 1);
    setNotice(null);
    dialog.current?.showModal();
  }

  return (
    <>
      {mode === "edit" ? (
        <>
          <button type="button" onClick={open} aria-label={goal ? t("Edit {name}", { name: goal.name }) : t("Edit goal")} className="grid size-8 place-items-center rounded-ctl text-ink-3 transition-colors duration-150 hover:bg-surface-3 hover:text-ink-1">
            <Pencil aria-hidden className="size-4" />
          </button>
          {/* The card itself shows the change; this tells a screen reader. */}
          <span role="status" className="sr-only">
            {notice}
          </span>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-y-1">
          {/* Always in the DOM so screen readers announce it; spaced only when it speaks. */}
          <p role="status" className={clsx("flex items-center gap-1 text-xs font-semibold text-good-ink", notice && "mr-3")}>
            {notice ? (
              <>
                <CircleCheck aria-hidden className="size-3.5" />
                {notice}
              </>
            ) : null}
          </p>
          <button type="button" onClick={open} className={mode === "empty" ? clsx(buttonPrimary, "h-9") : buttonSmall}>
            <Plus aria-hidden className="size-4" />
            {mode === "empty" ? t("Add a goal") : t("New goal")}
          </button>
        </div>
      )}
      <Dialog
        dialogRef={dialog}
        title={goal ? t("Edit {name}", { name: goal.name }) : household ? t("A new household goal") : t("A new goal")}
        description={goal ? undefined : t("Name it, give it a number and a month, and Prism charts the way there.")}
        icon={PiggyBank}
      >
        <GoalForm
          key={session}
          goal={goal}
          others={others}
          today={today}
          signedIn={signedIn}
          household={household}
          accounts={accounts}
          onDone={(message) => {
            setNotice(message);
            dialog.current?.close();
          }}
          onCancel={() => dialog.current?.close()}
        />
      </Dialog>
    </>
  );
}

function GoalForm({
  goal,
  others,
  today,
  signedIn,
  household,
  accounts,
  onDone,
  onCancel,
}: {
  goal?: GoalSettings;
  others: GoalSettings[];
  today: string;
  signedIn: boolean;
  household: boolean;
  accounts: FollowableAccount[];
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [state, action, pending] = useActionState(async (prev: PlanFormState, form: FormData) => {
    const next = form.get("intent") === "delete" ? await deleteGoal(prev, form) : await saveGoal(prev, form);
    if (next.status === "saved") onDone(next.message);
    return next;
  }, IDLE);
  const [confirming, setConfirming] = useState(false);
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  // One account, one goal: the ones other goals follow aren't offered.
  const free = accounts.filter((a) => !others.some((o) => o.id !== goal?.id && o.accountId === a.id));
  const [follow, setFollow] = useState(goal?.accountId ?? "");
  const followed = free.find((a) => a.id === follow);
  // Still following an account that's gone (unshared, disconnected): keep the choice until they change it.
  const gone = goal?.accountId && !accounts.some((a) => a.id === goal.accountId) ? goal.accountId : null;

  const taken = new Set(others.filter((g) => g.id !== goal?.id).map((g) => g.emoji));
  const emoji = goal?.emoji ?? GOAL_EMOJIS.find((e) => !taken.has(e)) ?? GOAL_EMOJIS[0];
  const target = goal?.targetDate ?? addMonths(today, 12);
  const thisYear = Number(today.slice(0, 4));
  const years = Array.from({ length: GOAL_HORIZON_YEARS + 1 }, (_, i) => String(thisYear + i));
  // A goal whose month has passed still opens showing its own year.
  if (target.slice(0, 4) < years[0]!) years.unshift(target.slice(0, 4));

  // By hand, not <form action>: React resets a form after its action, which
  // would throw away everything typed whenever a save needs a correction.
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => action(form));
  }

  function remove() {
    const form = new FormData();
    form.set("intent", "delete");
    form.set("id", goal?.id ?? "");
    if (household) form.set("scope", "household");
    startTransition(() => action(form));
  }

  return (
    <form onSubmit={submit} noValidate>
      <input type="hidden" name="id" value={goal?.id ?? ""} />
      {household ? <input type="hidden" name="scope" value="household" /> : null}
      <div className="grid gap-4">
        <TextInput name="name" label={t("What are you saving for?")} defaultValue={goal?.name ?? ""} maxLength={GOAL_NAME_MAX} error={errors.name} />

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-semibold text-ink-2">{t("Icon")}</legend>
          <div className="grid grid-cols-6 gap-2">
            {GOAL_EMOJIS.map((e) => (
              <label key={e} className="relative">
                <input type="radio" name="emoji" value={e} defaultChecked={e === emoji} className="peer sr-only" />
                <span
                  aria-hidden
                  className="grid h-11 cursor-pointer place-items-center rounded-ctl border border-line bg-surface-2 text-xl transition-colors duration-150 hover:bg-surface-3 peer-checked:border-accent peer-checked:bg-accent-soft peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)]"
                >
                  {e}
                </span>
                <span className="sr-only">{t(EMOJI_NAMES[e])}</span>
              </label>
            ))}
          </div>
          {errors.emoji ? <p className="mt-1 text-xs font-medium text-crit-ink">{errors.emoji}</p> : null}
        </fieldset>

        {free.length || gone ? (
          <div>
            <SelectInput
              name="account"
              label={t("Saved so far comes from")}
              showLabel
              defaultValue={follow}
              onChange={setFollow}
              invalid={Boolean(errors.account)}
              options={[
                { value: "", label: t("What I enter") },
                ...free.map((a) => ({ value: a.id, label: `${a.name} · ${a.detail}` })),
                ...(gone ? [{ value: gone, label: t("The account it followed (not available now)") }] : []),
              ]}
            />
            {errors.account ? <p className="mt-1 text-xs font-medium text-crit-ink">{errors.account}</p> : null}
            {followed ? (
              <p className="mt-1.5 text-xs text-ink-3">
                {t("{amount} in {account} today. What's saved follows its balance from now on, month by month.", {
                  amount: money0(followed.balance),
                  account: followed.name,
                })}
              </p>
            ) : null}
          </div>
        ) : (
          <input type="hidden" name="account" value="" />
        )}

        <div className={clsx("grid gap-4", follow ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
          <MoneyInput name="target" label={t("Target")} defaultValue={goal ? dollarsInput(goal.target) : ""} placeholder="5,000" error={errors.target} />
          {follow ? (
            // The balance travels as the last amount known, shown if the account ever goes away.
            <input type="hidden" name="saved" value={dollarsInput(followed ? Math.max(0, followed.balance) : (goal?.saved ?? 0))} />
          ) : (
            <MoneyInput name="saved" label={t("Saved so far")} defaultValue={goal ? dollarsInput(goal.saved) : ""} placeholder="0" error={errors.saved} />
          )}
          <MoneyInput name="monthly" label={t("Each month")} defaultValue={goal ? dollarsInput(goal.monthlyContribution) : ""} placeholder="200" error={errors.monthly} />
        </div>

        <fieldset>
          <legend className="mb-1 text-[13px] font-semibold text-ink-2">{t("Reach it by")}</legend>
          <div className="grid grid-cols-[1.4fr_1fr] gap-2">
            <SelectInput
              name="month"
              label={t("Month")}
              defaultValue={String(Number(target.slice(5, 7)))}
              options={MONTHS.map((mm) => ({ value: String(Number(mm)), label: capitalized(monthLong(`2000-${mm}`, t.locale)) }))}
              invalid={Boolean(errors.targetDate)}
            />
            <SelectInput name="year" label={t("Year")} defaultValue={target.slice(0, 4)} options={years.map((y) => ({ value: y, label: y }))} invalid={Boolean(errors.targetDate)} />
          </div>
          {errors.targetDate ? <p className="mt-1 text-xs font-medium text-crit-ink">{errors.targetDate}</p> : null}
        </fieldset>
      </div>

      <FormMessage state={state} />

      {confirming ? (
        <div role="alert" className="mt-5 rounded-ctl border border-line-strong bg-surface-2 p-3">
          <p className="text-sm font-semibold text-ink-1">
            {household
              ? t("Delete “{name}”? Its progress chart goes with it, for everyone in your household.", { name: goal?.name ?? "" })
              : t("Delete “{name}”? Its progress chart goes with it.", { name: goal?.name ?? "" })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={remove} disabled={pending} className="inline-flex h-9 items-center gap-1.5 rounded-ctl border border-crit bg-surface-1 px-3.5 text-sm font-semibold text-crit-ink transition-colors duration-150 hover:bg-surface-3 disabled:opacity-60">
              <Trash2 aria-hidden className="size-4" />
              {pending ? t("Deleting…") : t("Delete goal")}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={buttonSmall}>
              {t("Keep it")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        {goal && !confirming ? (
          <button type="button" onClick={() => setConfirming(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-crit-ink hover:underline">
            <Trash2 aria-hidden className="size-4" />
            {t("Delete")}
          </button>
        ) : (
          <span />
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onCancel} className={buttonGhost}>
            {t("Cancel")}
          </button>
          <button type="submit" disabled={pending} className={buttonPrimary}>
            {pending ? t("Saving…") : goal ? t("Save goal") : t("Add goal")}
          </button>
        </div>
      </div>
      <p className="mt-4 text-xs text-ink-3">
        {household ? t("Saved for your household: everyone in it can update it.") : signedIn ? t("Saved to your account.") : t("Saved in this browser only.")}{" "}
        {follow ? t("What's saved updates itself from the account.") : t("Update what you've saved whenever you like.")}
      </p>
    </form>
  );
}

/** Demo only: throw away this device's goal edits and bring back Alex's goals. */
export function RestoreGoals() {
  const t = useT();
  const [state, action, pending] = useActionState(restoreGoals, IDLE);
  return (
    <form action={action}>
      <button type="submit" disabled={pending} className={clsx(buttonSmall, "border-transparent text-ink-2")}>
        <RotateCcw aria-hidden className="size-4" />
        {pending ? t("Restoring…") : t("Restore example goals")}
      </button>
      {state.status === "error" ? <p className="mt-1 text-xs text-crit-ink">{state.message}</p> : null}
    </form>
  );
}
