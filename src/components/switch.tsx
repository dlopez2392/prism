"use client";

// src/components/switch.tsx
//
// One setting that's on or off and takes effect the moment it's flipped: a
// switch (role="switch"), named by its label and explained by one line. No
// Save: flipping it back is the undo.

import { useId } from "react";
import clsx from "clsx";

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div id={`${id}-label`} className="text-sm font-semibold text-ink-1">
          {label}
        </div>
        {description ? (
          <p id={`${id}-description`} className="mt-0.5 text-xs text-ink-3">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          "relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-pill border transition-colors duration-150 disabled:opacity-60",
          checked ? "border-transparent bg-button" : "border-line-strong bg-surface-3",
        )}
      >
        <span aria-hidden className={clsx("inline-block size-4 rounded-pill transition-transform duration-150", checked ? "translate-x-5 bg-ink-on-accent" : "translate-x-1 bg-ink-3")} />
      </button>
    </div>
  );
}
