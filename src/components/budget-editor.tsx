"use client";

// src/components/budget-editor.tsx
//
// "Edit budgets": one money field per category, each beside what that
// category usually costs a month, so a limit is set against what's real. Blank
// means "don't budget this". Saving writes the person's plan (their account,
// or this device when signed out) — or, in the Household view, the
// household's, from the version this editor was showing — and the page
// re-renders around it — rings, pacing and the overview all move together.

import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import { CircleCheck, Pencil, Plus, Target } from "lucide-react";
import clsx from "clsx";
import { CategoryIcon } from "@/components/category-icon";
import { buttonGhost, buttonPrimary, buttonSmall, Dialog, FormMessage, MoneyInput } from "@/components/dialog";
import { categoryLabel, SPEND_CATEGORIES } from "@/lib/finance/categories";
import { useT } from "@/components/locale";
import { money0 } from "@/lib/finance/format";
import { dollarsInput, IDLE, type PlanFormState, type TypicalSpend } from "@/lib/finance/plan";
import type { Budget } from "@/lib/finance/types";
import { resetBudgets, saveBudgets } from "@/lib/server/plan-actions";

type Props = {
  budgets: Budget[];
  typical: TypicalSpend;
  /** True once the person has saved their own budgets. */
  edited: boolean;
  /** Signed in: saves go to the account, and the footer says so. */
  signedIn?: boolean;
  /** The household's budgets, not the person's: saved from this version, for everyone in it. */
  household?: { version: number };
  variant?: "ghost" | "primary";
  label?: string;
};

export function BudgetEditor({ budgets, typical, edited, signedIn = false, household, variant = "ghost", label }: Props) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  // A fresh form every time the editor opens: nothing half-typed or stale
  // from a cancelled visit survives into the next one.
  const [session, setSession] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  function open() {
    setSession((s) => s + 1);
    setNotice(null);
    dialog.current?.showModal();
  }

  const Icon = variant === "primary" ? Plus : Pencil;
  return (
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
      <button type="button" onClick={open} className={variant === "primary" ? clsx(buttonPrimary, "h-9") : buttonSmall}>
        <Icon aria-hidden className="size-4" />
        {label ?? t("Edit budgets")}
      </button>
      <Dialog
        dialogRef={dialog}
        title={household ? t("Your household's monthly budgets") : t("Your monthly budgets")}
        description={
          household
            ? t("Limits for what the household spends from shared accounts. Leave one blank to stop budgeting it.")
            : t("Set a limit for any category. Leave one blank to stop budgeting it.")
        }
        icon={Target}
      >
        <BudgetForm
          key={session}
          budgets={budgets}
          typical={typical}
          edited={edited}
          signedIn={signedIn}
          household={household}
          onDone={(message) => {
            setNotice(message);
            dialog.current?.close();
          }}
          onCancel={() => dialog.current?.close()}
        />
      </Dialog>
    </div>
  );
}

function BudgetForm({
  budgets,
  typical,
  edited,
  signedIn,
  household,
  onDone,
  onCancel,
}: Omit<Props, "variant" | "label"> & { onDone: (message: string) => void; onCancel: () => void }) {
  const t = useT();
  const [state, action, pending] = useActionState(async (prev: PlanFormState, form: FormData) => {
    const next = form.get("intent") === "reset" ? await resetBudgets(form) : await saveBudgets(prev, form);
    if (next.status === "saved") onDone(next.message);
    return next;
  }, IDLE);
  const limits = new Map(budgets.map((b) => [b.category, b.limit]));
  const errors = state.status === "error" ? (state.fields ?? {}) : {};

  // Dispatched by hand rather than through <form action>: React resets a form
  // after its action runs, which would wipe every field the moment a save
  // came back with "check the highlighted amounts".
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => action(form));
  }

  // Reset is a plain button dispatching the action, never a second submit
  // button: pressing Enter in a field must always mean "save".
  function reset() {
    const form = new FormData();
    form.set("intent", "reset");
    if (household) {
      form.set("scope", "household");
      form.set("version", String(household.version));
    }
    startTransition(() => action(form));
  }

  return (
    <form onSubmit={submit} noValidate>
      {household ? (
        <>
          <input type="hidden" name="scope" value="household" />
          <input type="hidden" name="version" value={household.version} />
        </>
      ) : null}
      <ul className="divide-y divide-[var(--line)] border-y border-line">
        {SPEND_CATEGORIES.map((c) => {
          const limit = limits.get(c);
          return (
            <li key={c} className="grid grid-cols-[minmax(0,1fr)_132px] items-start gap-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_160px]">
              <div className="flex min-w-0 items-center gap-2.5 pt-1.5">
                <CategoryIcon category={c} size="sm" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink-1">{categoryLabel(c, t)}</div>
                  <div className="num text-xs text-ink-3">{typical[c] > 0 ? t("Usually {amount}/mo", { amount: money0(typical[c]) }) : t("No spending lately")}</div>
                </div>
              </div>
              <MoneyInput
                name={`limit:${c}`}
                defaultValue={limit ? dollarsInput(limit) : ""}
                label={t("{category} monthly budget", { category: categoryLabel(c, t) })}
                hideLabel
                placeholder={t("No budget")}
                error={errors[c]}
              />
            </li>
          );
        })}
      </ul>
      <FormMessage state={state} />
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        {edited ? (
          <button type="button" onClick={reset} disabled={pending} className="text-sm font-semibold text-accent-ink hover:underline disabled:opacity-60">
            {household ? t("Go back to the drafted budgets") : t("Use the suggested budgets")}
          </button>
        ) : (
          <span />
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onCancel} className={buttonGhost}>
            {t("Cancel")}
          </button>
          <button type="submit" disabled={pending} className={buttonPrimary}>
            {pending ? t("Saving…") : t("Save budgets")}
          </button>
        </div>
      </div>
      <p className="mt-4 text-xs text-ink-3">
        {household
          ? t("Saved for your household. Everyone in it sees these budgets and can change them.")
          : signedIn
            ? t("Saved to your account — on every device you sign in on.")
            : t("Saved in this browser only — they won't follow you to another device.")}
      </p>
    </form>
  );
}
