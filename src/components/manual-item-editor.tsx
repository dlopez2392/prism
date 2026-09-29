"use client";

// src/components/manual-item-editor.tsx
//
// "Add something you own or owe" on Net worth — a home, a vehicle, anything
// else of value, or money owed — and the same form to update its value,
// rename it or remove it. Saved to the person's account; each update becomes
// that month's value, so its trend line and "12 mo" change stay honest.
// Removing asks once, because an item's history can't be brought back.

import { startTransition, useActionState, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Car, CircleCheck, Gem, HandCoins, House, Plus, Trash2, type LucideIcon } from "lucide-react";
import clsx from "clsx";
import { buttonGhost, buttonPrimary, buttonSmall, Dialog, FormMessage, MoneyInput, TextInput } from "@/components/dialog";
import { MANUAL_KINDS, MANUAL_NAME_MAX, type ManualItem, type ManualKind } from "@/lib/finance/manual";
import { dollarsInput, IDLE, type PlanFormState } from "@/lib/finance/plan";
import { deleteManualItem, saveManualItem } from "@/lib/server/manual-actions";

const ICONS: Record<ManualKind, LucideIcon> = { home: House, vehicle: Car, asset: Gem, debt: HandCoins };
const KINDS = Object.keys(MANUAL_KINDS) as ManualKind[];

/** The "Add" button, with its dialog and the line that says what was saved. */
export function AddManualItem() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [session, setSession] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
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
      <button
        type="button"
        onClick={() => {
          setSession((s) => s + 1);
          setNotice(null);
          dialog.current?.showModal();
        }}
        className={buttonSmall}
      >
        <Plus aria-hidden className="size-4" />
        Add
      </button>
      <ManualDialog dialogRef={dialog} session={session} onDone={setNotice} />
    </div>
  );
}

/** A Net worth row for something the person added: the whole row opens it for editing. */
export function ManualItemRow({ item, label, children }: { item: ManualItem; label: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [session, setSession] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          setSession((s) => s + 1);
          setNotice(null);
          dialog.current?.showModal();
        }}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-ctl px-2 py-2.5 text-left transition-colors duration-150 hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
      >
        {children}
      </button>
      {/* The row itself shows the change; this tells a screen reader. */}
      <span role="status" className="sr-only">
        {notice}
      </span>
      <ManualDialog dialogRef={dialog} session={session} item={item} onDone={setNotice} />
    </>
  );
}

function ManualDialog({
  dialogRef,
  session,
  item,
  onDone,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  session: number;
  item?: ManualItem;
  onDone: (message: string) => void;
}) {
  return (
    <Dialog
      dialogRef={dialogRef}
      title={item ? item.name : "Add something you own or owe"}
      description={item ? "Update its value whenever it changes. Prism keeps the trend." : "A home, a car, a loan from family: anything a bank doesn't report, so your net worth is the whole picture."}
      icon={item ? ICONS[item.kind] : Plus}
    >
      <ManualForm
        key={session}
        item={item}
        onDone={(message) => {
          onDone(message);
          dialogRef.current?.close();
        }}
        onCancel={() => dialogRef.current?.close()}
      />
    </Dialog>
  );
}

function ManualForm({ item, onDone, onCancel }: { item?: ManualItem; onDone: (message: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(async (prev: PlanFormState, form: FormData) => {
    const next = form.get("intent") === "delete" ? await deleteManualItem(prev, form) : await saveManualItem(prev, form);
    if (next.status === "saved") onDone(next.message);
    return next;
  }, IDLE);
  const [kind, setKind] = useState<ManualKind>(item?.kind ?? "home");
  const [confirming, setConfirming] = useState(false);
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  const meta = MANUAL_KINDS[kind];

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
    form.set("id", item?.id ?? "");
    startTransition(() => action(form));
  }

  return (
    <form onSubmit={submit} noValidate>
      <input type="hidden" name="id" value={item?.id ?? ""} />
      <div className="grid gap-4">
        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-ink-2">What is it?</legend>
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map((k) => {
              const Icon = ICONS[k];
              return (
                <label key={k} className="relative">
                  <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="peer sr-only" />
                  <span className="flex min-h-12 cursor-pointer items-center gap-2 rounded-ctl border border-line bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3 peer-checked:border-accent peer-checked:bg-accent-soft peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)]">
                    <Icon aria-hidden className="size-4 shrink-0 text-accent" />
                    <span className="min-w-0 leading-tight">{MANUAL_KINDS[k].label}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {errors.kind ? <p className="mt-1 text-xs font-medium text-crit-ink">{errors.kind}</p> : null}
        </fieldset>
        <TextInput name="name" label="Name" defaultValue={item?.name ?? ""} maxLength={MANUAL_NAME_MAX} error={errors.name} hint={`For example, “${meta.placeholder}”.`} />
        <MoneyInput
          name="value"
          label={meta.owed ? "How much you owe today" : "What it's worth today"}
          defaultValue={item ? dollarsInput(item.values.at(-1)!.value) : ""}
          placeholder={meta.owed ? "5,000" : "350,000"}
          error={errors.value}
          hint={item ? "Saved as this month's value; earlier months keep theirs." : undefined}
        />
      </div>

      <FormMessage state={state} />

      {confirming ? (
        <div role="alert" className="mt-5 rounded-ctl border border-line-strong bg-surface-2 p-3">
          <p className="text-sm font-semibold text-ink-1">Remove “{item?.name}”? Its history goes with it.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={remove} disabled={pending} className="inline-flex h-9 items-center gap-1.5 rounded-ctl border border-crit bg-surface-1 px-3.5 text-sm font-semibold text-crit-ink transition-colors duration-150 hover:bg-surface-3 disabled:opacity-60">
              <Trash2 aria-hidden className="size-4" />
              {pending ? "Removing…" : "Remove it"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={buttonSmall}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        {item && !confirming ? (
          <button type="button" onClick={() => setConfirming(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-crit-ink hover:underline">
            <Trash2 aria-hidden className="size-4" />
            Remove
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className={buttonGhost}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={clsx(buttonPrimary, "min-w-24")}>
            {pending ? "Saving…" : item ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </form>
  );
}
