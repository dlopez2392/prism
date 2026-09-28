"use client";

// src/components/sign-in-form.tsx
//
// Two steps, one card: an email address, then the code from the email. The
// email is the only thing asked for here — an optional field beside it is
// where people type passwords by mistake, so the name to greet you by is
// asked for after sign-in. The email keeps what was typed when a step comes
// back with a correction — React resets a form after its action, so its
// default value is fed from the action's returned state.

import { useActionState } from "react";
import { Mail } from "lucide-react";
import { buttonGhost, buttonPrimary } from "@/components/dialog";
import { signInStep, type SignInState } from "@/lib/server/auth-actions";

const input =
  "h-11 w-full rounded-ctl border border-line-strong bg-surface-2 px-3 text-[15px] text-ink-1 placeholder:text-ink-3 focus:border-[var(--focus)] aria-[invalid=true]:border-crit";

export function SignInForm({ linkError, next }: { linkError: boolean; next?: string | null }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInStep, { step: "email" });

  if (state.step === "code") {
    return (
      <form action={action} noValidate>
        <input type="hidden" name="email" value={state.email} />
        <p className="text-sm text-ink-2">
          We sent a code to <span className="font-semibold text-ink-1">{state.email}</span>
          {state.resent ? " — a fresh one" : ""}. It works once, for about an hour. You can also tap the link in that email on this device.
        </p>
        <label htmlFor="code" className="mt-5 mb-1 block text-[13px] font-semibold text-ink-2">
          Code from the email
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 -]*"
          maxLength={14}
          autoFocus
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "code-error" : undefined}
          className={`${input} num text-center text-xl font-bold tracking-[0.3em]`}
        />
        {state.error ? (
          <p id="code-error" role="alert" className="mt-2 text-sm font-medium text-crit-ink">
            {state.error}
          </p>
        ) : null}
        <button type="submit" name="intent" value="verify" disabled={pending} className={`${buttonPrimary} mt-5 w-full`}>
          {pending ? "Checking…" : "Sign in"}
        </button>
        <div className="mt-3 flex flex-wrap justify-between gap-2">
          <button type="submit" name="intent" value="resend" disabled={pending} className="text-sm font-semibold text-accent-ink hover:underline disabled:opacity-60">
            Send a new code
          </button>
          <button type="submit" name="intent" value="change" disabled={pending} className="text-sm font-semibold text-ink-2 hover:underline disabled:opacity-60">
            Use a different email
          </button>
        </div>
      </form>
    );
  }

  return (
    <form action={action} noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {linkError && !state.error ? (
        <p role="alert" className="mb-4 rounded-ctl bg-surface-2 px-3 py-2 text-sm font-medium text-ink-1">
          That sign-in link has expired or was already used. Ask for a new code below.
        </p>
      ) : null}
      <label htmlFor="email" className="mb-1 block text-[13px] font-semibold text-ink-2">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        defaultValue={state.email ?? ""}
        placeholder="you@example.com"
        autoFocus
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? "email-error" : undefined}
        className={input}
      />
      {state.error ? (
        <p id="email-error" role="alert" className="mt-3 text-sm font-medium text-crit-ink">
          {state.error}
        </p>
      ) : null}
      {/* The primary button comes first, so Enter always sends the code. */}
      <button type="submit" name="intent" value="send" disabled={pending} className={`${buttonPrimary} mt-5 w-full`}>
        <Mail aria-hidden className="size-4" />
        {pending ? "Sending…" : "Email me a code"}
      </button>
      <p className="mt-3 text-center text-xs text-ink-3">No password. New here? The same code creates your account.</p>
    </form>
  );
}

export function SignOutButton({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action}>
      <button type="submit" className={buttonGhost}>
        Sign out
      </button>
    </form>
  );
}
