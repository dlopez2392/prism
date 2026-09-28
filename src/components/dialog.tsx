"use client";

// src/components/dialog.tsx
//
// The one modal frame: a native <dialog> opened with showModal(), so the
// browser traps focus, Esc closes it, and the page behind goes inert. Plus the
// form controls every editor shares, so a money field looks and fails the same
// way on Budgets and on Goals.

import { useId, type ComponentType, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import clsx from "clsx";

export function Dialog({
  dialogRef,
  title,
  description,
  icon: Icon,
  children,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  title: string;
  description?: ReactNode;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-title`}
      className="m-auto max-h-[92dvh] w-[min(94vw,540px)] overflow-y-auto rounded-card border border-line bg-surface-1 p-0 text-ink-1 shadow-pop backdrop:bg-[var(--surface-0)]/70 backdrop:backdrop-blur-sm"
    >
      <div className="p-5 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-ctl bg-accent-soft text-accent">
              <Icon className="size-5" />
            </div>
            <div className="min-w-0">
              <h2 id={`${id}-title`} className="text-lg font-bold leading-tight">
                {title}
              </h2>
              {description ? <p className="mt-0.5 text-[13px] text-ink-3">{description}</p> : null}
            </div>
          </div>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className="grid size-8 shrink-0 place-items-center rounded-ctl text-ink-3 hover:bg-surface-3">
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

const control =
  "h-10 w-full rounded-ctl border bg-surface-2 text-sm text-ink-1 placeholder:text-ink-3 focus:border-[var(--focus)] aria-[invalid=true]:border-crit";

/** A dollar amount: "$" inside the field, numeric keypad on phones. */
export function MoneyInput({
  name,
  defaultValue,
  label,
  error,
  placeholder,
  hideLabel = false,
  hint,
}: {
  name: string;
  defaultValue: string;
  label: string;
  error?: string;
  placeholder?: string;
  hideLabel?: boolean;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={clsx("mb-1 block text-[13px] font-semibold text-ink-2", hideLabel && "sr-only")}>
        {label}
      </label>
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-sm text-ink-3">
          $
        </span>
        <input
          id={id}
          name={name}
          defaultValue={defaultValue}
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-note` : undefined}
          className={clsx(control, "num border-line-strong pr-3 pl-7")}
        />
      </div>
      {error ? (
        <p id={`${id}-note`} className="mt-1 text-xs font-medium text-crit-ink">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-note`} className="mt-1 text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  name,
  defaultValue,
  label,
  error,
  maxLength,
  hint,
  autoComplete = "off",
  autoFocus,
}: {
  name: string;
  defaultValue: string;
  label: string;
  error?: string;
  maxLength?: number;
  /** A standing line under the field; an error takes its place. */
  hint?: string;
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const note = error ?? hint;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      <input
        id={id}
        name={name}
        defaultValue={defaultValue}
        maxLength={maxLength}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? `${id}-note` : undefined}
        className={clsx(control, "border-line-strong px-3")}
      />
      {note ? (
        <p id={`${id}-note`} className={clsx("mt-1 text-xs", error ? "font-medium text-crit-ink" : "text-ink-3")}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

export function SelectInput({
  name,
  defaultValue,
  label,
  options,
  invalid,
}: {
  name: string;
  defaultValue: string;
  label: string;
  options: { value: string; label: string }[];
  invalid?: boolean;
}) {
  // A sibling label, not a wrapping one: wrapped, the select's accessible
  // name swallowed every option ("MonthJanuaryFebruary…").
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select id={id} name={name} defaultValue={defaultValue} aria-invalid={invalid ? true : undefined} className={clsx(control, "border-line-strong px-3 font-semibold")}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FormMessage({ state }: { state: { status: string; message?: string } }) {
  if (state.status !== "error" || !state.message) return null;
  return (
    <p role="alert" className="mt-4 rounded-ctl bg-surface-2 px-3 py-2 text-sm font-medium text-crit-ink">
      {state.message}
    </p>
  );
}

export const buttonPrimary =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-ctl bg-button px-4 text-sm font-semibold text-ink-on-accent transition-colors duration-150 hover:bg-button-hover disabled:opacity-60";
export const buttonGhost =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-ctl border border-line-strong px-4 text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3 disabled:opacity-60";
export const buttonSmall =
  "inline-flex h-9 items-center gap-1.5 rounded-ctl border border-line-strong px-3.5 text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3";
