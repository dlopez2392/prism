"use client";

// src/components/connect-bank.tsx
//
// "Connect a bank": fetch a Link token, load Plaid Link from Plaid's CDN on
// demand (nothing third-party loads until the person asks to link), then trade
// the one-time public token for a sealed access token server-side and refresh.
// Without Plaid keys the button explains demo mode instead of failing.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark, Lock, Plus, X } from "lucide-react";
import clsx from "clsx";

type PlaidHandler = { open: () => void; destroy: () => void };
type PlaidLinkFactory = {
  create: (opts: {
    token: string;
    onSuccess: (publicToken: string, metadata: { institution?: { name?: string } | null }) => void;
    onExit: (err: { display_message?: string | null; error_message?: string } | null) => void;
  }) => PlaidHandler;
};

declare global {
  interface Window {
    Plaid?: PlaidLinkFactory;
  }
}

const LINK_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

function loadLink(): Promise<PlaidLinkFactory> {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${LINK_SCRIPT}"]`);
    const s = existing ?? document.createElement("script");
    s.addEventListener("load", () => (window.Plaid ? resolve(window.Plaid) : reject(new Error("Plaid Link failed to load."))));
    s.addEventListener("error", () => reject(new Error("Plaid Link failed to load.")));
    if (!existing) {
      s.src = LINK_SCRIPT;
      s.async = true;
      document.head.appendChild(s);
    }
  });
}

type State = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "error"; message: string } | { kind: "done"; message: string };

export function ConnectBank({
  variant = "ghost",
  label = "Connect a bank",
  className,
}: {
  /** "hero" is the white button that sits on the --gradient-prism card. */
  variant?: "primary" | "ghost" | "hero";
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const dialog = useRef<HTMLDialogElement>(null);

  async function start() {
    setState({ kind: "busy", label: "Opening secure link…" });
    try {
      const res = await fetch("/api/plaid/link-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const json = (await res.json().catch(() => ({}))) as { linkToken?: string; error?: string; message?: string };
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
          setState({ kind: "busy", label: `Securing ${metadata.institution?.name ?? "your bank"}…` });
          const ex = await fetch("/api/plaid/exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ publicToken }),
          });
          const exJson = (await ex.json().catch(() => ({}))) as { message?: string; institutionName?: string | null };
          if (!ex.ok) {
            setState({ kind: "error", message: exJson.message ?? "The bank linked, but we couldn't save it. Try again." });
            return;
          }
          setState({ kind: "done", message: `${exJson.institutionName ?? "Your bank"} is connected. Pulling in your transactions…` });
          router.refresh();
          handler.destroy();
        },
        onExit: (err) => {
          setState(err ? { kind: "error", message: err.display_message ?? "The connection was cancelled." } : { kind: "idle" });
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
          "inline-flex h-9 items-center gap-1.5 rounded-ctl px-3.5 text-sm font-semibold transition-colors duration-150 disabled:opacity-60",
          variant === "primary" && "bg-button text-ink-on-accent hover:bg-button-hover",
          variant === "ghost" && "border border-line-strong text-ink-1 hover:bg-surface-3",
          variant === "hero" && "bg-[var(--on-hero)] text-[var(--button)] hover:opacity-90",
        )}
      >
        <Plus aria-hidden className="size-4" strokeWidth={2.5} />
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
