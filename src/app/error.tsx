"use client";

// The error state: say what happened in plain words, offer the one action
// that usually fixes it, and never show a stack trace to a customer.

import { RefreshCw } from "lucide-react";

export default function ErrorState({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-card border border-line bg-surface-1 p-8 text-center shadow-card">
      <div className="mx-auto grid size-12 place-items-center rounded-card bg-accent-soft text-accent">
        <RefreshCw className="size-6" />
      </div>
      <h1 className="mt-4 text-lg font-bold text-ink-1">We couldn&apos;t load your money just now</h1>
      <p className="mt-2 text-sm text-ink-2">Your accounts are fine — this page hit a snag while fetching them. Trying again usually does it.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-5 inline-flex h-9 items-center justify-center rounded-ctl bg-button px-4 text-sm font-semibold text-ink-on-accent hover:bg-button-hover"
      >
        Try again
      </button>
    </div>
  );
}
