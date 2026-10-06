"use client";

// src/components/name-form.tsx
//
// The one thing Prism asks about a person: what to call them. It is asked
// after sign-in — on an account's first visit as a welcome step, and on the
// Account page any time after — never beside the email box on the sign-in
// form, where people type passwords by mistake.

import Link from "next/link";
import { startTransition, useActionState, type FormEvent } from "react";
import { CircleCheck } from "lucide-react";
import { buttonGhost, buttonPrimary, FormMessage, TextInput } from "@/components/dialog";
import { useT } from "@/components/locale";
import { IDLE } from "@/lib/finance/plan";
import { FIRST_NAME_MAX } from "@/lib/profile";
import { saveFirstName } from "@/lib/server/profile-actions";

export function NameForm({ firstName, welcome }: { firstName: string | null; welcome: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveFirstName, IDLE);
  const fieldError = state.status === "error" ? state.fields?.firstName : undefined;

  // By hand, not <form action>: React resets a form after its action, which
  // would throw away what was typed whenever it needs a correction.
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => action(form));
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4">
      {welcome ? <input type="hidden" name="next" value="welcome" /> : null}
      <div className="max-w-sm">
        <TextInput
          name="firstName"
          label={t("First name")}
          defaultValue={firstName ?? ""}
          maxLength={FIRST_NAME_MAX}
          autoComplete="given-name"
          autoFocus={welcome}
          hint={t("Just your first name. Prism never asks for a password.")}
          error={fieldError}
        />
      </div>
      {fieldError ? null : <FormMessage state={state} />}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonPrimary}>
          {pending ? t("Saving…") : welcome ? t("Save and continue") : t("Save name")}
        </button>
        {welcome ? (
          <Link href="/" className={buttonGhost}>
            {t("Skip for now")}
          </Link>
        ) : null}
        {/* Always in the DOM so screen readers announce it. */}
        <p role="status" className="flex items-center gap-1 text-xs font-semibold text-good-ink">
          {state.status === "saved" ? (
            <>
              <CircleCheck aria-hidden className="size-3.5" />
              {state.message}
            </>
          ) : null}
        </p>
      </div>
    </form>
  );
}
