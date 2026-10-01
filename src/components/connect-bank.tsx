"use client";

// src/components/connect-bank.tsx
//
// "Connect a bank": fetch a Link token, load Plaid Link from Plaid's CDN on
// demand (nothing third-party loads until the person asks to link), then trade
// the one-time public token for a sealed access token server-side and refresh.
// Without Plaid keys the button explains demo mode instead of failing.
//
// A bank that signs people in on its own website may take the whole page there
// (phones, in-app browsers); it sends them back to /connections/return, which
// finishes the job and returns them to the page named in `from`.
//
// With accounts on, a bank connects only to a signed-in account. Someone
// signed out goes to sign in first (`signInFirst`, or the server's
// `sign_in_required` if the page didn't know), then comes back here.
//
// With `reconnect` (a linked bank's id), the same button signs the person in
// to THAT bank again — Plaid's update mode — when a changed password or an
// expired consent has stopped it updating. The connection Prism already
// holds carries on, so there's nothing to save afterwards, only a refresh.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark, Lock, Plus, RotateCw, X } from "lucide-react";
import clsx from "clsx";
import { signInToConnect } from "@/lib/linking";
import { loadLink, saveBank } from "@/lib/plaid/link";
import { bankSignedInAgain } from "@/lib/server/bank-actions";

type State = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "error"; message: string } | { kind: "done"; message: string };

export function ConnectBank({
  variant = "ghost",
  label = "Connect a bank",
  className,
  landOn,
  signInFirst = false,
  reconnect,
  size = "md",
}: {
  /** "hero" is the white button that sits on the --gradient-prism card. */
  variant?: "primary" | "ghost" | "hero";
  label?: string;
  className?: string;
  /** Where the person lands once the bank is saved (a full load), instead of a refresh of the page the button is on. */
  landOn?: string;
  /** Nobody is signed in and accounts are on: go to sign-in, and come back here, instead of opening Link. */
  signInFirst?: boolean;
  /** A linked bank's id: sign in to it again instead of connecting a new one. */
  reconnect?: string;
  /** "sm" sits in a row beside the row's other actions (Disconnect). */
  size?: "md" | "sm";
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const dialog = useRef<HTMLDialogElement>(null);

  async function start() {
    const from = landOn ?? `${window.location.pathname}${window.location.search}`;
    if (signInFirst) {
      window.location.assign(signInToConnect("bank", from));
      return;
    }
    setState({ kind: "busy", label: "Opening secure link…" });
    try {
      const res = await fetch("/api/plaid/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reconnect ? { from, itemId: reconnect } : { from }),
      });
      const json = (await res.json().catch(() => ({}))) as { linkToken?: string; error?: string; message?: string };
      if (res.status === 401 && json.error === "sign_in_required") {
        window.location.assign(signInToConnect("bank", from));
        return;
      }
      if (res.status === 503 && json.error === "not_configured") {
        setState({ kind: "idle" });
        dialog.current?.showModal();
        return;
      }
      if (!res.ok || !json.linkToken) throw new Error(json.message ?? "We couldn't start the connection. Try again in a minute.");
      const Plaid = await loadLink();
      const handler = Plaid.create({
        token: json.linkToken,
        onSuccess: async (publicToken, metadata) => {
          if (reconnect) {
            handler.destroy();
            setState({ kind: "done", message: `${metadata.institution?.name ?? "Your bank"} is reconnected. Bringing it up to date…` });
            // Whatever Plaid warned about this bank is over now.
            await bankSignedInAgain(reconnect);
            if (landOn) window.location.replace(landOn);
            else router.refresh();
            return;
          }
          setState({ kind: "busy", label: `Securing ${metadata.institution?.name ?? "your bank"}…` });
          const saved = await saveBank(publicToken);
          if (!saved.ok && saved.signIn) {
            handler.destroy();
            window.location.assign(signInToConnect("bank", from));
            return;
          }
          if (!saved.ok) {
            setState({ kind: "error", message: saved.message });
            return;
          }
          setState({ kind: "done", message: `${saved.institutionName ?? "Your bank"} is connected. Pulling in your transactions…` });
          handler.destroy();
          if (landOn) window.location.replace(landOn);
          else router.refresh();
        },
        onExit: (err) => {
          setState(err ? { kind: "error", message: err.display_message ?? (reconnect ? "Your bank didn't finish signing you in. Try again in a minute." : "The connection was cancelled.") } : { kind: "idle" });
          handler.destroy();
        },
      });
      handler.open();
      setState({ kind: "idle" });
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  }

  const busy = state.kind === "busy";
  return (
    <div className={clsx("relative", className)}>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className={clsx(
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-ctl font-semibold transition-colors duration-150 disabled:opacity-60",
          size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
          variant === "primary" && "bg-button text-ink-on-accent hover:bg-button-hover",
          variant === "ghost" && "border border-line-strong text-ink-1 hover:bg-surface-3",
          variant === "hero" && "bg-[var(--on-hero)] text-[var(--button)] hover:opacity-90",
        )}
      >
        {reconnect ? (
          <RotateCw aria-hidden className={size === "sm" ? "size-3.5" : "size-4"} strokeWidth={2.5} />
        ) : (
          <Plus aria-hidden className={size === "sm" ? "size-3.5" : "size-4"} strokeWidth={2.5} />
        )}
        {busy ? state.label : label}
      </button>
      {state.kind === "error" || state.kind === "done" ? (
        <p
          role="status"
          className={clsx(
            "mt-2 max-w-xs text-xs font-medium",
            variant === "hero" ? "text-[var(--on-hero)]" : state.kind === "error" ? "text-crit-ink" : "text-good-ink",
          )}
        >
          {state.message}
        </p>
      ) : null}

      <dialog
        ref={dialog}
        className="m-auto w-[min(92vw,460px)] rounded-card border border-line bg-surface-1 p-0 text-ink-1 shadow-pop backdrop:bg-[var(--surface-0)]/70 backdrop:backdrop-blur-sm"
      >
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="grid size-11 place-items-center rounded-card bg-accent-soft text-accent">
              <Landmark className="size-5" />
            </div>
            <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" className="grid size-8 place-items-center rounded-ctl text-ink-3 hover:bg-surface-3">
              <X className="size-4" />
            </button>
          </div>
          <h2 className="text-lg font-bold">You&apos;re exploring a demo household</h2>
          <p className="mt-2 text-sm text-ink-2">
            Everything you see is Alex&apos;s made-up money, so you can try every chart before sharing anything real. Linking a real bank
            takes one step once this app has its bank-connection keys.
          </p>
          <div className="mt-4 rounded-ctl bg-surface-2 p-3 text-xs text-ink-2">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-ink-1">
              <Lock className="size-3.5" /> For whoever runs this deployment
            </div>
            Set <code className="font-semibold">PLAID_CLIENT_ID</code> and <code className="font-semibold">PLAID_SECRET</code> (sandbox keys are free), plus{" "}
            <code className="font-semibold">PRISM_VAULT_KEY</code> in production. In the sandbox, sign in to any test bank with{" "}
            <code className="font-semibold">user_good</code> / <code className="font-semibold">pass_good</code>.
          </div>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="mt-5 inline-flex h-9 w-full items-center justify-center rounded-ctl bg-accent text-sm font-semibold text-ink-on-accent hover:bg-accent-strong"
          >
            Keep exploring
          </button>
        </div>
      </dialog>
    </div>
  );
}
