"use client";

// src/components/two-step.tsx
//
// Two-step sign-in with an authenticator app: the code asked for after the
// email code (TwoStepForm), and the Account page's switch (TwoStepSettings),
// which sets it up with a QR code, or turns it off with a current code.
// Codes are checked here in the browser (lib/supabase/browser.ts explains
// why); the server records the result, and the database decides what a
// session that passed may do.

import { useActionState, useRef, useState, useTransition } from "react";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { buttonGhost, buttonPrimary } from "@/components/dialog";
import { StatusPill } from "@/components/ui";
import { registerFactor, startSetup, turnOff, type SetupStart } from "@/lib/server/two-step-actions";
import { checkCode } from "@/lib/supabase/browser";
import type { SupabaseEnv } from "@/lib/supabase/config";
import { useT } from "@/components/locale";

const input =
  "h-11 w-full rounded-ctl border border-line-strong bg-surface-2 px-3 text-[15px] text-ink-1 placeholder:text-ink-3 focus:border-[var(--focus)] aria-[invalid=true]:border-crit";

const readCode = (form: FormData) => String(form.get("code") ?? "");

function CodeField({ id, label, error, autoFocus = true }: { id: string; label: string; error?: string; autoFocus?: boolean }) {
  return (
    <>
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      <input
        id={id}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${input} num text-center text-xl font-bold tracking-[0.3em]`}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-2 text-sm font-medium text-crit-ink">
          {error}
        </p>
      ) : null}
    </>
  );
}

type FormState = { status: "idle" | "done" } | { status: "error"; message: string };
const errorOf = (s: FormState) => (s.status === "error" ? s.message : undefined);

/** The second step of signing in, against the authenticator the server says is this person's. */
export function TwoStepForm({ next, factorId, supabase }: { next: string | null; factorId: string; supabase: SupabaseEnv }) {
  const t = useT();
  const [state, action, pending] = useActionState<FormState, FormData>(async (_prev, form) => {
    const checked = await checkCode(supabase, factorId, readCode(form));
    if (!checked.ok) return { status: "error", message: t(checked.error) };
    // A full load, not a client navigation: every server component re-reads the upgraded session.
    window.location.assign(next ?? "/");
    return { status: "done" };
  }, { status: "idle" });
  const busy = pending || state.status === "done";
  return (
    <form action={action} noValidate>
      <CodeField id="code" label={t("Code from your authenticator app")} error={errorOf(state)} />
      <button type="submit" disabled={busy} className={`${buttonPrimary} mt-5 w-full`}>
        {state.status === "done" ? t("Signing you in…") : pending ? t("Checking…") : t("Finish signing in")}
      </button>
    </form>
  );
}

/** "a b c d …" in groups of four, so the secret is easy to type into an app by hand. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, "$1 ").trim();

/**
 * The Account page switch. `factorId` is the registered authenticator, or
 * null when two-step sign-in is off; the page re-renders with the new value
 * after each change, so this component only holds the step in between.
 */
export function TwoStepSettings({ factorId, supabase }: { factorId: string | null; supabase: SupabaseEnv }) {
  const t = useT();
  const [setup, setSetup] = useState<SetupStart | null>(null);
  const [starting, startTransition] = useTransition();
  const [askingOff, setAskingOff] = useState(false);
  // A code that already checked out doesn't need entering again if only the server's half failed.
  const passed = useRef<string | null>(null);

  const [onState, onAction, turningOn] = useActionState<FormState, FormData>(async (_prev, form) => {
    if (!setup?.ok) return { status: "error", message: t("Start set-up again.") };
    if (passed.current !== setup.factorId) {
      const checked = await checkCode(supabase, setup.factorId, readCode(form));
      if (!checked.ok) return { status: "error", message: t(checked.error) };
      passed.current = setup.factorId;
    }
    const saved = await registerFactor(setup.factorId);
    if (!saved.ok) return { status: "error", message: saved.error };
    setSetup(null);
    return { status: "done" };
  }, { status: "idle" });

  const [offState, offAction, turningOff] = useActionState<FormState, FormData>(async (_prev, form) => {
    if (!factorId) return { status: "done" };
    const checked = await checkCode(supabase, factorId, readCode(form));
    if (!checked.ok) return { status: "error", message: t(checked.error) };
    const off = await turnOff();
    if (!off.ok) return { status: "error", message: off.error };
    setAskingOff(false);
    return { status: "done" };
  }, { status: "idle" });

  if (factorId) {
    return (
      <div>
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
          <StatusPill status="good">{t("On")}</StatusPill>
          {t("After your email code, Prism asks for a code from your authenticator app.")}
        </p>
        {onState.status === "done" && !askingOff ? (
          <p role="status" className="mt-2 text-xs font-semibold text-ink-2">
            {t("Two-step sign-in is on. Next time you sign in, have your phone handy.")}
          </p>
        ) : null}
        {askingOff ? (
          <form action={offAction} noValidate className="mt-4 max-w-xs">
            <CodeField id="off-code" label={t("A current code, to turn it off")} error={errorOf(offState)} />
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="submit" disabled={turningOff} className={buttonGhost}>
                <ShieldOff aria-hidden className="size-4" />
                {turningOff ? t("Turning off…") : t("Turn off two-step sign-in")}
              </button>
              <button type="button" onClick={() => setAskingOff(false)} className="text-sm font-semibold text-ink-2 hover:underline">
                {t("Keep it on")}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setAskingOff(true)} className={`${buttonGhost} mt-4`}>
            {t("Turn off")}
          </button>
        )}
      </div>
    );
  }

  if (setup?.ok) {
    return (
      <form action={onAction} noValidate>
        <ol className="list-decimal space-y-3 pl-5 text-sm text-ink-2 marker:font-semibold marker:text-ink-3">
          <li>{t("Open an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator, 1Password or Authy.")}</li>
          <li>
            {t("Scan this code with it.")}
            {/* The QR image is an SVG from Supabase Auth; shown as an image, nothing in it can run. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qrCode} alt={t("QR code to add Prism to your authenticator app")} width={176} height={176} className="mt-3 block rounded-ctl bg-[var(--qr-ground)] p-2" />
            <span className="mt-2 block text-xs text-ink-3">
              {t("Can't scan it? Type this key into the app instead:")}{" "}
              <code className="num font-mono text-[13px] font-semibold break-all text-ink-1">{grouped(setup.secret)}</code>
            </span>
          </li>
          <li>{t("Enter the 6-digit code the app now shows for Prism.")}</li>
        </ol>
        <div className="mt-4 max-w-xs">
          <CodeField id="setup-code" label={t("Code from the app")} error={errorOf(onState)} autoFocus={false} />
        </div>
        <p className="mt-3 text-xs text-ink-3">
          {t("Keep that key somewhere safe, like a password manager. If you lose your phone, adding it to a new app gets you back in.")}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="submit" disabled={turningOn} className={buttonPrimary}>
            <ShieldCheck aria-hidden className="size-4" />
            {turningOn ? t("Checking…") : t("Turn on two-step sign-in")}
          </button>
          <button type="button" onClick={() => setSetup(null)} className="text-sm font-semibold text-ink-2 hover:underline">
            {t("Cancel")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div>
      <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
        <StatusPill status="neutral">{t("Off")}</StatusPill>
        {t("Right now, your email inbox alone can open your account.")}
      </p>
      {offState.status === "done" ? (
        <p role="status" className="mt-2 text-xs font-semibold text-ink-2">
          {t("Two-step sign-in is off.")}
        </p>
      ) : null}
      {setup && !setup.ok ? (
        <p role="alert" className="mt-2 text-sm font-medium text-crit-ink">
          {setup.error}
        </p>
      ) : null}
      <button type="button" disabled={starting} onClick={() => startTransition(async () => setSetup(await startSetup()))} className={`${buttonPrimary} mt-4`}>
        <KeyRound aria-hidden className="size-4" />
        {starting ? t("Getting a code ready…") : t("Set up two-step sign-in")}
      </button>
    </div>
  );
}
