"use client";

// src/components/category-fixer.tsx
//
// "Change category" for one transaction: pick a category, and (by default)
// use it for every purchase at that merchant, past and future. Saved to the
// person's account by fixCategory; the page re-renders with every chart,
// budget and insight already agreeing. A transaction the person changed can
// go back to the bank's category from here too.

import { startTransition, useActionState, type FormEvent } from "react";
import { RotateCcw, Tags } from "lucide-react";
import clsx from "clsx";
import { CategoryIcon } from "@/components/category-icon";
import { buttonGhost, buttonPrimary, Dialog, FormMessage } from "@/components/dialog";
import { CATEGORIES } from "@/lib/finance/categories";
import { choicesFor } from "@/lib/finance/category-rules";
import { money, shortDate } from "@/lib/finance/format";
import { IDLE, type PlanFormState } from "@/lib/finance/plan";
import type { Transaction } from "@/lib/finance/types";
import { fixCategory } from "@/lib/server/category-actions";

export function CategoryFixDialog({
  dialogRef,
  transaction,
  session,
  onDone,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  transaction: Transaction | null;
  /** A new number each time the dialog opens, so the form starts fresh. */
  session: number;
  onDone: (message: string) => void;
}) {
  return (
    <Dialog
      dialogRef={dialogRef}
      title="Change category"
      description={transaction ? `${transaction.merchant} · ${transaction.amount > 0 ? "+" : ""}${money(transaction.amount)} · ${shortDate(transaction.date)}` : undefined}
      icon={Tags}
    >
      {transaction ? (
        <FixForm
          key={`${session}-${transaction.id}`}
          t={transaction}
          onDone={(message) => {
            onDone(message);
            dialogRef.current?.close();
          }}
          onCancel={() => dialogRef.current?.close()}
        />
      ) : null}
    </Dialog>
  );
}

function FixForm({ t, onDone, onCancel }: { t: Transaction; onDone: (message: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(async (prev: PlanFormState, form: FormData) => {
    const next = await fixCategory(prev, form);
    if (next.status === "saved") onDone(next.message);
    return next;
  }, IDLE);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => action(form));
  }

  function reset() {
    const form = new FormData();
    form.set("intent", "reset");
    form.set("transactionId", t.id);
    form.set("merchant", t.merchant);
    startTransition(() => action(form));
  }

  return (
    <form onSubmit={submit} noValidate>
      <input type="hidden" name="transactionId" value={t.id} />
      <input type="hidden" name="merchant" value={t.merchant} />
      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold text-ink-2">Category</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {choicesFor(t.amount).map((c) => (
            <label key={c} className="relative">
              <input type="radio" name="category" value={c} defaultChecked={c === t.category} className="peer sr-only" />
              <span className="flex h-12 cursor-pointer items-center gap-2 rounded-ctl border border-line bg-surface-2 px-2.5 text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3 peer-checked:border-accent peer-checked:bg-accent-soft peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)]">
                <CategoryIcon category={c} size="sm" />
                <span className="min-w-0 leading-tight">{CATEGORIES[c].label}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-ctl bg-surface-2 p-3 text-sm text-ink-1">
        <input type="checkbox" name="everyAtMerchant" defaultChecked className="mt-0.5 size-4 shrink-0 accent-[var(--button)]" />
        <span>
          Use this for every purchase at <span className="font-semibold">{t.merchant}</span>, past and future
        </span>
      </label>

      {t.bankCategory ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-3">
          <span>Your bank called this {CATEGORIES[t.bankCategory].label}.</span>
          <button type="button" onClick={reset} disabled={pending} className="inline-flex items-center gap-1 text-left font-semibold text-ink-2 hover:text-ink-1 hover:underline disabled:opacity-60">
            <RotateCcw aria-hidden className="size-3.5" />
            Use the bank&apos;s categories for {t.merchant}
          </button>
        </div>
      ) : null}

      <FormMessage state={state} />

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={buttonGhost}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={clsx(buttonPrimary, "min-w-24")}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
