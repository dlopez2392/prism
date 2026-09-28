"use client";

// src/components/delete-account.tsx
//
// Deleting an account is the one action that can't be undone, so it asks for
// the email address typed out — never a reflexive "Are you sure?".

import { useActionState, useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteAccount, type DeleteState } from "@/lib/server/auth-actions";

export function DeleteAccount({ email }: { email: string }) {
  const [state, action, pending] = useActionState<DeleteState, FormData>(deleteAccount, {});
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === email.toLowerCase();
  return (
    <form action={action} className="mt-4">
      <label htmlFor="confirm-delete" className="mb-1 block text-[13px] font-semibold text-ink-2">
        Type <span className="font-bold text-ink-1">{email}</span> to confirm
      </label>
      <input
        id="confirm-delete"
        name="confirm"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="off"
        className="h-10 w-full rounded-ctl border border-line-strong bg-surface-2 px-3 text-sm text-ink-1 focus:border-[var(--focus)]"
      />
      {state.error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-crit-ink">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!matches || pending}
        className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-ctl border border-crit bg-surface-1 px-4 text-sm font-semibold text-crit-ink transition-colors duration-150 hover:bg-surface-3 disabled:opacity-40"
      >
        <Trash2 aria-hidden className="size-4" />
        {pending ? "Deleting…" : "Delete my account"}
      </button>
    </form>
  );
}
