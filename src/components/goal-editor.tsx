"use client";

// src/components/goal-editor.tsx
//
// Add, edit and delete a savings goal, saved to the account (or this device
// when signed out), or, in the Household view, to the household. The same form
// serves all three: a new goal starts blank with a finish line a year out; an
// existing one opens with its numbers and a two-step delete, because a goal's
// history is the one thing an edit can't bring back.

import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import { CircleCheck, Pencil, PiggyBank, Plus, RotateCcw, Trash2 } from "lucide-react";
import clsx from "clsx";
import { buttonGhost, buttonPrimary, buttonSmall, Dialog, FormMessage, MoneyInput, SelectInput, TextInput } from "@/components/dialog";
import { addMonths } from "@/lib/finance/dates";
import { dollarsInput, GOAL_EMOJIS, GOAL_HORIZON_YEARS, GOAL_NAME_MAX, IDLE, type GoalSettings, type PlanFormState } from "@/lib/finance/plan";
import { deleteGoal, restoreGoals, saveGoal } from "@/lib/server/plan-actions";

const EMOJI_NAMES: Record<(typeof GOAL_EMOJIS)[number], string> = {
  "🛟": "Life ring",
  "🏡": "House",
  "🗾": "Map",
  "💻": "Laptop",
  "🚗": "Car",
  "🎓": "Graduation cap",
  "💍": "Ring",
  "👶": "Baby",
  "🏖️": "Beach",
  "🎁": "Gift",
  "🐶": "Dog",
  "🌱": "Seedling",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Mode = "new" | "edit" | "empty";

export function GoalEditor({
  goal,
  others,
  today,
  mode,
  signedIn = false,
  household = false,
}: {
  goal?: GoalSettings;
  others: GoalSettings[];
  today: string;
  mode: Mode;
  signedIn?: boolean;
  /** A household goal: saved for everyone in it. */
  household?: boolean;
}) {
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
          <button type="button" onClick={open} aria-label={`Edit ${goal?.name ?? "goal"}`} className="grid size-8 place-items-center rounded-ctl text-ink-3 transition-colors duration-150 hover:bg-surface-3 hover:text-ink-1">
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
            {mode === "empty" ? "Add a goal" : "New goal"}
          </button>
        </div>
      )}
      <Dialog
        dialogRef={dialog}
        title={goal ? `Edit ${goal.name}` : household ? "A new household goal" : "A new goal"}
        description={goal ? undefined : "Name it, give it a number and a month, and Prism charts the way there."}
        icon={PiggyBank}
      >
        <GoalForm
          key={session}
          goal={goal}
          others={others}
          today={today}
          signedIn={signedIn}
          household={household}
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
  onDone,
  onCancel,
}: {
  goal?: GoalSettings;
  others: GoalSettings[];
  today: string;
  signedIn: boolean;
  household: boolean;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState(async (prev: PlanFormState, form: FormData) => {
    const next = form.get("intent") === "delete" ? await deleteGoal(prev, form) : await saveGoal(prev, form);
    if (next.status === "saved") onDone(next.message);
    return next;
  }, IDLE);
  const [confirming, setConfirming] = useState(false);
  const errors = state.status === "error" ? (state.fields ?? {}) : {};

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
        <TextInput name="name" label="What are you saving for?" defaultValue={goal?.name ?? ""} maxLength={GOAL_NAME_MAX} error={errors.name} />

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-semibold text-ink-2">Icon</legend>
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
                <span className="sr-only">{EMOJI_NAMES[e]}</span>
              </label>
            ))}
          </div>
          {errors.emoji ? <p className="mt-1 text-xs font-medium text-crit-ink">{errors.emoji}</p> : null}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-3">
          <MoneyInput name="target" label="Target" defaultValue={goal ? dollarsInput(goal.target) : ""} placeholder="5,000" error={errors.target} />
          <MoneyInput name="saved" label="Saved so far" defaultValue={goal ? dollarsInput(goal.saved) : ""} placeholder="0" error={errors.saved} />
          <MoneyInput name="monthly" label="Each month" defaultValue={goal ? dollarsInput(goal.monthlyContribution) : ""} placeholder="200" error={errors.monthly} />
        </div>

        <fieldset>
          <legend className="mb-1 text-[13px] font-semibold text-ink-2">Reach it by</legend>
          <div className="grid grid-cols-[1.4fr_1fr] gap-2">
            <SelectInput
              name="month"
              label="Month"
              defaultValue={String(Number(target.slice(5, 7)))}
              options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
              invalid={Boolean(errors.targetDate)}
            />
            <SelectInput name="year" label="Year" defaultValue={target.slice(0, 4)} options={years.map((y) => ({ value: y, label: y }))} invalid={Boolean(errors.targetDate)} />
          </div>
          {errors.targetDate ? <p className="mt-1 text-xs font-medium text-crit-ink">{errors.targetDate}</p> : null}
        </fieldset>
      </div>

      <FormMessage state={state} />

      {confirming ? (
        <div role="alert" className="mt-5 rounded-ctl border border-line-strong bg-surface-2 p-3">
          <p className="text-sm font-semibold text-ink-1">
            Delete “{goal?.name}”? Its progress chart goes with it{household ? ", for everyone in your household" : ""}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={remove} disabled={pending} className="inline-flex h-9 items-center gap-1.5 rounded-ctl border border-crit bg-surface-1 px-3.5 text-sm font-semibold text-crit-ink transition-colors duration-150 hover:bg-surface-3 disabled:opacity-60">
              <Trash2 aria-hidden className="size-4" />
              {pending ? "Deleting…" : "Delete goal"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={buttonSmall}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        {goal && !confirming ? (
          <button type="button" onClick={() => setConfirming(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-crit-ink hover:underline">
            <Trash2 aria-hidden className="size-4" />
            Delete
          </button>
        ) : (
          <span />
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onCancel} className={buttonGhost}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={buttonPrimary}>
            {pending ? "Saving…" : goal ? "Save goal" : "Add goal"}
          </button>
        </div>
      </div>
      <p className="mt-4 text-xs text-ink-3">
        {household ? "Saved for your household: everyone in it can update it. " : signedIn ? "Saved to your account. " : "Saved in this browser only. "}Update what
        you&apos;ve saved whenever you like.
      </p>
    </form>
  );
}

/** Demo only: throw away this device's goal edits and bring back Alex's goals. */
export function RestoreGoals() {
  const [state, action, pending] = useActionState(restoreGoals, IDLE);
  return (
    <form action={action}>
      <button type="submit" disabled={pending} className={clsx(buttonSmall, "border-transparent text-ink-2")}>
        <RotateCcw aria-hidden className="size-4" />
        {pending ? "Restoring…" : "Restore example goals"}
      </button>
      {state.status === "error" ? <p className="mt-1 text-xs text-crit-ink">{state.message}</p> : null}
    </form>
  );
}
