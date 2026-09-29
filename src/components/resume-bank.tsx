"use client";

// src/components/resume-bank.tsx
//
// Back from a bank's own sign-in page: reopen Link with the SAME Link token
// and this page's full address (Plaid's oauth_state_id included), so Link
// picks up exactly where it left off. Then save the bank as usual and take
// the person back to where they started. A full page load, so every
// screen, the layout included, redraws with the new bank.

import { useEffect, useRef, useState } from "react";
import { Landmark } from "lucide-react";
import { ConnectBank } from "@/components/connect-bank";
import { ButtonLink, Card, StatusPill } from "@/components/ui";
import { signInToConnect } from "@/lib/linking";
import { loadLink, saveBank, type PlaidHandler } from "@/lib/plaid/link";

type State =
  | { kind: "resuming" }
  | { kind: "saving"; name: string }
  | { kind: "done"; name: string }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

const TITLE: Record<State["kind"], string> = {
  resuming: "Finishing your bank connection",
  saving: "Finishing your bank connection",
  done: "Your bank is connected",
  cancelled: "Your bank isn't connected",
  error: "We couldn't finish connecting",
};

export function ResumeBank({ linkToken, back }: { linkToken: string; back: string }) {
  const [state, setState] = useState<State>({ kind: "resuming" });
  // Link resumes a bank sign-in once. React's development double-run of effects must not start it twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let handler: PlaidHandler | null = null;
    loadLink()
      .then((Plaid) => {
        handler = Plaid.create({
          token: linkToken,
          receivedRedirectUri: window.location.href,
          onSuccess: async (publicToken, metadata) => {
            const name = metadata.institution?.name ?? "Your bank";
            setState({ kind: "saving", name });
            const saved = await saveBank(publicToken);
            handler?.destroy();
            if (!saved.ok && saved.signIn) {
              window.location.assign(signInToConnect("bank", back));
              return;
            }
            if (!saved.ok) {
              setState({ kind: "error", message: saved.message });
              return;
            }
            setState({ kind: "done", name: saved.institutionName ?? name });
            window.location.replace(back);
          },
          onExit: (err) => {
            handler?.destroy();
            setState(err ? { kind: "error", message: err.display_message ?? "Your bank didn't finish the connection. Nothing was shared." } : { kind: "cancelled" });
          },
        });
        handler.open();
      })
      .catch(() => setState({ kind: "error", message: "The secure connection window didn't load. Check your connection, then try again." }));
  }, [linkToken, back]);

  const settled = state.kind === "cancelled" || state.kind === "error";
  return (
    <div className="mx-auto max-w-md pt-2 sm:pt-8">
      <Card className="p-6 sm:p-8">
        <div className="grid size-12 place-items-center rounded-card bg-accent-soft text-accent">
          <Landmark aria-hidden className="size-6" />
        </div>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink-1">{TITLE[state.kind]}</h1>
        <div role="status" aria-live="polite" className="mt-3">
          {state.kind === "resuming" ? (
            <div aria-busy="true">
              <p className="text-sm text-ink-2">Your bank sent you back. Finish the last step in the secure window and you&apos;re done.</p>
              <div className="skeleton mt-4 h-6 w-44 rounded-pill" />
            </div>
          ) : state.kind === "saving" ? (
            <StatusPill status="syncing">Saving {state.name}…</StatusPill>
          ) : state.kind === "done" ? (
            <div>
              <StatusPill status="good">{state.name} is connected</StatusPill>
              <p className="mt-2 text-sm text-ink-2">Taking you back and pulling in your transactions…</p>
            </div>
          ) : state.kind === "cancelled" ? (
            // The heading says it in words; a status pill here would wear the kit's neutral check mark, which reads as success.
            <p className="text-sm text-ink-2">You closed the window before finishing, so nothing was shared. You can start again any time.</p>
          ) : (
            <div>
              <StatusPill status="warn">Not connected</StatusPill>
              <p className="mt-2 text-sm text-ink-2">{state.message}</p>
            </div>
          )}
        </div>
        {settled ? (
          <div className="mt-6 flex flex-wrap items-start gap-3">
            <ConnectBank variant="primary" label="Try again" landOn={back} />
            <ButtonLink href={back}>Go back</ButtonLink>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
